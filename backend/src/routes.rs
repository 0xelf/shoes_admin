use actix_web::{web, HttpRequest, HttpResponse};
use log::info;
use rust_embed::RustEmbed;
use serde::Deserialize;

use crate::app_state::{platform_info, ApiResp, SharedState};
use crate::auth;
use crate::config_store::{self, ConfigDoc, ConfigEntry};
use crate::downloader;
use crate::proxy_manager;

#[derive(RustEmbed)]
#[folder = "../frontend/dist/"]
struct Assets;

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api")
            .route("/health", web::get().to(health))
            .route("/auth/login", web::post().to(auth::login))
            .route("/auth/password", web::put().to(auth::change_password))
            .route("/status", web::get().to(get_status))
            .route("/config", web::get().to(get_config))
            .route("/config", web::put().to(put_config))
            .route("/config/default", web::post().to(reset_config))
            .route("/proxy/start", web::post().to(start_proxy))
            .route("/proxy/stop", web::post().to(stop_proxy))
            .route("/proxy/logs", web::get().to(get_logs))
            .route("/proxy/logs/clear", web::post().to(clear_logs))
            .route("/download/status", web::get().to(get_download_status))
            .route("/download/retry", web::post().to(retry_download))
            .route("/settings", web::get().to(get_settings))
            .route("/settings", web::put().to(put_settings)),
    )
    .default_service(web::route().to(serve_spa));
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(ApiResp::ok("ok", serde_json::json!({
        "service": "shoes-admin",
        "version": env!("CARGO_PKG_VERSION"),
    })))
}

// ---------- 状态 ----------

async fn get_status(state: web::Data<SharedState>) -> HttpResponse {
    let (os, arch, proxy_supported) = platform_info();
    let proxy = state.proxy.lock().unwrap().status();
    let download = state.download.lock().unwrap().status();
    let entry_count = state.config.lock().unwrap().doc.entries.len();
    let settings = state.settings.lock().unwrap();
    let username = settings.username.clone();

    HttpResponse::Ok().json(ApiResp::ok("ok", serde_json::json!({
        "panel_version": env!("CARGO_PKG_VERSION"),
        "platform": { "os": os, "arch": arch, "proxy_supported": proxy_supported },
        "proxy": proxy,
        "download": download,
        "config_entry_count": entry_count,
        "username": username,
        "server_time": chrono::Utc::now().timestamp(),
    })))
}

// ---------- 配置 ----------

async fn get_config(state: web::Data<SharedState>) -> HttpResponse {
    let store = state.config.lock().unwrap();
    let yaml_preview = store.generate_yaml();
    HttpResponse::Ok().json(ApiResp::ok("ok", serde_json::json!({
        "doc": store.doc,
        "generated_yaml": yaml_preview,
    })))
}

#[derive(Deserialize)]
struct PutConfigReq {
    entries: Vec<ConfigEntry>,
}

async fn put_config(
    state: web::Data<SharedState>,
    body: web::Json<PutConfigReq>,
) -> HttpResponse {
    // 校验
    for (i, entry) in body.entries.iter().enumerate() {
        if let Err(msg) = config_store::validate_entry(entry) {
            let name = match entry {
                ConfigEntry::Visual { name, .. } | ConfigEntry::Yaml { name, .. } => name.clone(),
            };
            return HttpResponse::BadRequest()
                .json(ApiResp::<()>::err(format!("第 {} 条「{}」: {}", i + 1, name, msg)));
        }
    }

    // 补齐 id
    let mut entries = body.entries.clone();
    for entry in entries.iter_mut() {
        let id = match entry {
            ConfigEntry::Visual { id, .. } | ConfigEntry::Yaml { id, .. } => id,
        };
        if id.trim().is_empty() {
            *id = uuid::Uuid::new_v4().to_string();
        }
    }

    let mut store = state.config.lock().unwrap();
    store.doc.entries = entries;
    match config_store::save_and_generate(&store, &state.data_dir) {
        Ok(yaml) => {
            info!("配置已保存，共 {} 个条目", store.doc.entries.len());
            HttpResponse::Ok().json(ApiResp::ok("配置已保存", serde_json::json!({
                "generated_yaml": yaml,
                "saved_entries": store.doc.entries.len(),
            })))
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResp::<()>::err(e)),
    }
}

async fn reset_config(state: web::Data<SharedState>) -> HttpResponse {
    let mut store = state.config.lock().unwrap();
    store.doc = ConfigDoc::default_doc();
    match config_store::save_and_generate(&store, &state.data_dir) {
        Ok(yaml) => HttpResponse::Ok().json(ApiResp::ok("已恢复默认配置", serde_json::json!({
            "generated_yaml": yaml,
        }))),
        Err(e) => HttpResponse::InternalServerError().json(ApiResp::<()>::err(e)),
    }
}

// ---------- 代理启停 ----------

async fn start_proxy(state: web::Data<SharedState>) -> HttpResponse {
    let (os, _, supported) = platform_info();
    if !supported {
        return HttpResponse::BadRequest().json(ApiResp::<()>::err(format!(
            "当前平台 ({}) 官方未提供 shoes 预编译产物，代理功能不可用",
            os
        )));
    }
    // 二进制就绪检查
    if !proxy_manager::binary_exists(&state.bin_dir) {
        let d = state.download.lock().unwrap().status();
        let msg = if d.state == downloader::DownloadState::Downloading {
            "代理二进制正在下载中，请稍候".to_string()
        } else if !d.message.is_empty() {
            d.message.clone()
        } else {
            "代理二进制未就绪，请检查下载状态".to_string()
        };
        return HttpResponse::BadRequest().json(ApiResp::<()>::err(msg));
    }
    match proxy_manager::start(&state).await {
        Ok(()) => HttpResponse::Ok().json(ApiResp::ok_void("代理已启动")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResp::<()>::err(e)),
    }
}

async fn stop_proxy(state: web::Data<SharedState>) -> HttpResponse {
    match proxy_manager::stop(state.proxy.clone()) {
        Ok(()) => HttpResponse::Ok().json(ApiResp::ok_void("代理已停止")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResp::<()>::err(e)),
    }
}

async fn get_logs(state: web::Data<SharedState>, req: HttpRequest) -> HttpResponse {
    let lines: usize = req
        .query_string()
        .split('&')
        .find_map(|kv| {
            let mut it = kv.splitn(2, '=');
            if it.next() == Some("lines") {
                it.next().and_then(|v| v.parse().ok())
            } else {
                None
            }
        })
        .unwrap_or(500);
    let pm = state.proxy.lock().unwrap();
    HttpResponse::Ok().json(ApiResp::ok("ok", serde_json::json!({
        "logs": pm.recent_logs(lines),
        "state": pm.status().state,
    })))
}

async fn clear_logs(state: web::Data<SharedState>) -> HttpResponse {
    proxy_manager::clear_logs(&state);
    HttpResponse::Ok().json(ApiResp::ok_void("日志已清空"))
}

// ---------- 下载 ----------

async fn get_download_status(state: web::Data<SharedState>) -> HttpResponse {
    let s = state.download.lock().unwrap().status();
    HttpResponse::Ok().json(ApiResp::ok("ok", s))
}

async fn retry_download(state: web::Data<SharedState>) -> HttpResponse {
    let (os, _, _) = platform_info();
    downloader::spawn_retry(state.get_ref());
    HttpResponse::Ok().json(ApiResp::ok(
        format!("已开始检查 {} 平台的最新版本", os),
        serde_json::json!({}),
    ))
}

// ---------- 面板设置 ----------

#[derive(Deserialize)]
struct PutSettingsReq {
    listen: Option<String>,
    username: Option<String>,
}

async fn get_settings(state: web::Data<SharedState>) -> HttpResponse {
    let s = state.settings.lock().unwrap();
    let (os, arch, _) = platform_info();
    HttpResponse::Ok().json(ApiResp::ok("ok", serde_json::json!({
        "listen": s.listen,
        "username": s.username,
        "platform": { "os": os, "arch": arch },
        "panel_version": env!("CARGO_PKG_VERSION"),
        "default_username": "admin",
    })))
}

async fn put_settings(
    state: web::Data<SharedState>,
    body: web::Json<PutSettingsReq>,
) -> HttpResponse {
    let mut s = state.settings.lock().unwrap();
    if let Some(listen) = &body.listen {
        let listen = listen.trim().to_string();
        if !listen.contains(':') {
            return HttpResponse::BadRequest().json(ApiResp::<()>::err("监听地址格式应为 主机:端口"));
        }
        s.listen = listen;
    }
    if let Some(username) = &body.username {
        let u = username.trim().to_string();
        if u.is_empty() {
            return HttpResponse::BadRequest().json(ApiResp::<()>::err("用户名不能为空"));
        }
        s.username = u;
    }
    match s.save(&state.data_dir) {
        Ok(_) => HttpResponse::Ok().json(ApiResp::ok(
            "设置已保存，监听地址变更将在重启面板后生效",
            serde_json::json!({}),
        )),
        Err(e) => HttpResponse::InternalServerError().json(ApiResp::<()>::err(format!("保存失败: {}", e))),
    }
}

// ---------- 静态资源与 SPA fallback ----------

async fn serve_spa(req: HttpRequest) -> HttpResponse {
    let path = req.path().trim_start_matches('/');
    if path.starts_with("api/") {
        return HttpResponse::NotFound().json(ApiResp::<()>::err("接口不存在"));
    }
    let rel = if path.is_empty() { "index.html".to_string() } else { path.to_string() };
    let direct = Assets::get(&rel);
    let (data, mime) = match direct {
        Some(f) => (f.data.into_owned(), mime_guess::from_path(&rel).first_or_octet_stream().as_ref().to_string()),
        None => {
            let fallback = Assets::get("index.html");
            match fallback {
                Some(f) => (f.data.into_owned(), "text/html; charset=utf-8".to_string()),
                None => return HttpResponse::NotFound().body("Not Found"),
            }
        }
    };
    HttpResponse::Ok().content_type(mime).body(data)
}
