mod app_state;
mod auth;
mod config_store;
mod downloader;
mod logger;
mod proxy_manager;
mod routes;
mod settings;

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use actix_web::{middleware, web, App, HttpServer};
use app_state::{AppState, SharedState};
use log::{error, info};

/// 全局代理管理器引用：供控制台关闭事件处理器做退出清理
static PROXY_STATE: OnceLock<Arc<Mutex<proxy_manager::ProxyManager>>> = OnceLock::new();

/// Windows 控制台关闭事件：用户点击黑窗口的 × 时，先停止代理子进程再退出
#[cfg(windows)]
unsafe extern "system" fn console_ctrl_handler(ctrl_type: u32) -> i32 {
    use winapi::um::wincon::CTRL_CLOSE_EVENT;
    if ctrl_type == CTRL_CLOSE_EVENT {
        if let Some(proxy) = PROXY_STATE.get() {
            let _ = proxy_manager::stop(proxy.clone());
        }
        std::process::exit(0);
    }
    0 // 其他事件（Ctrl+C 等）交给默认处理
}

/// 探测 127.0.0.1:{port} 上是否已有 shoes-admin 实例在运行（通过公开的 health 接口识别）
fn probe_existing_instance(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    let Ok(addr) = addr.parse::<std::net::SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(800)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.write_all(
        b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    );
    let mut buf = Vec::new();
    let mut tmp = [0u8; 256];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if buf.windows(11).any(|w| w == b"shoes-admin") {
                    return true;
                }
                if buf.len() > 8192 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    buf.windows(11).any(|w| w == b"shoes-admin")
}

fn port_of(listen: &str) -> u16 {
    listen
        .rsplit(':')
        .next()
        .map(|s| s.trim_end_matches(']'))
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(6240)
}

/// 监听失败时的可见反馈：已有实例则打开浏览器，否则 Windows 弹窗提示
fn handle_bind_failure(listen: &str, port: u16, err: &std::io::Error) -> std::io::Error {
    error!("监听 {} 失败: {}", listen, err);
    if probe_existing_instance(port) {
        let _ = webbrowser::open(&format!("http://127.0.0.1:{}", port));
        info!("检测到已有实例，已打开管理界面");
    } else {
        #[cfg(windows)]
        show_bind_error_box(listen, err);
    }
    std::io::Error::new(
        err.kind(),
        format!("监听 {} 失败: {}", listen, err),
    )
}

#[cfg(windows)]
fn show_bind_error_box(listen: &str, err: &std::io::Error) {
    use std::os::windows::ffi::OsStrExt;
    let msg = format!(
        "shoes-admin 启动失败\n\n监听 {} 失败：\n{}\n\n可能原因：\n1. 端口被其他程序占用\n2. 无权限监听该地址\n\n解决方式：\n修改可执行文件同级的 data/app.json 中的 listen 配置，\n或关闭占用该端口的程序后重试。",
        listen, err
    );
    let wide: Vec<u16> = std::ffi::OsStr::new(&msg).encode_wide().chain(Some(0)).collect();
    let title: Vec<u16> = std::ffi::OsStr::new("shoes-admin").encode_wide().chain(Some(0)).collect();
    unsafe {
        winapi::um::winuser::MessageBoxW(
            std::ptr::null_mut(),
            wide.as_ptr(),
            title.as_ptr(),
            winapi::um::winuser::MB_OK
                | winapi::um::winuser::MB_ICONERROR
                | winapi::um::winuser::MB_TOPMOST
                | winapi::um::winuser::MB_SETFOREGROUND,
        );
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // 基础目录：环境变量覆盖，默认取可执行文件所在目录
    let base_dir = match std::env::var("SHOES_ADMIN_HOME") {
        Ok(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
        _ => std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| std::path::PathBuf::from(".")),
    };

    // 目录骨架：bin/ data/ data/logs/
    let bin_dir = base_dir.join("bin");
    let data_dir = base_dir.join("data");
    let logs_dir = data_dir.join("logs");
    for d in [&bin_dir, &data_dir, &logs_dir] {
        if let Err(e) = std::fs::create_dir_all(d) {
            eprintln!("创建目录失败 {}: {}", d.display(), e);
        }
    }

    // 文件日志：data/logs/admin.log（双击无控制台时错误也可见可查）
    if let Err(e) = logger::FileLogger::init(&logs_dir.join("admin.log")) {
        eprintln!("{}", e);
    }

    // 面板设置（含默认账号 admin/admin）
    let settings = Arc::new(std::sync::Mutex::new(
        settings::Settings::load_or_default(&data_dir),
    ));

    // 结构化配置存储（JSON 源 + YAML 生成）
    let config = Arc::new(std::sync::Mutex::new(config_store::ConfigStore::load_or_default(
        &data_dir,
    )));

    // 代理进程管理
    let proxy = Arc::new(std::sync::Mutex::new(proxy_manager::ProxyManager::new()));
    let _ = PROXY_STATE.set(proxy.clone());

    // Windows：注册控制台关闭事件处理（关黑窗口 → 停代理 → 退出）
    #[cfg(windows)]
    {
        use winapi::um::consoleapi::SetConsoleCtrlHandler;
        unsafe {
            SetConsoleCtrlHandler(Some(console_ctrl_handler), 1);
        }
    }

    // 下载器状态
    let download = Arc::new(std::sync::Mutex::new(downloader::DownloaderState::new()));

    let app_state: SharedState = Arc::new(AppState {
        base_dir: base_dir.clone(),
        bin_dir: bin_dir.clone(),
        data_dir: data_dir.clone(),
        settings,
        config,
        proxy,
        download,
    });

    // 监听地址
    let listen = {
        let s = app_state.settings.lock().unwrap();
        s.listen.clone()
    };
    let port = port_of(&listen);

    // 单实例保护：若端口上已有 shoes-admin 实例，提示后打开管理界面并退出（窗口停留 3 秒，避免闪退误判）
    if probe_existing_instance(port) {
        let url = format!("http://127.0.0.1:{}", port);
        info!("检测到已有 shoes-admin 实例正在运行（端口 {}）", port);
        info!("已为你打开管理界面: {}", url);
        println!();
        println!("==============================================");
        println!("  shoes-admin 已在运行（端口 {}）", port);
        println!("  正在为你打开管理界面: {}", url);
        println!("  本窗口 3 秒后自动关闭，服务不受影响");
        println!("==============================================");
        let _ = webbrowser::open(&url);
        std::thread::sleep(Duration::from_secs(3));
        return Ok(());
    }

    // 首次启动：非阻塞检查 shoes 二进制（下载 + 解压，不阻塞 HTTP 服务）
    downloader::spawn_download_if_needed(app_state.clone());

    // 注册关闭钩子：退出时尝试停止代理子进程
    {
        let st = app_state.clone();
        let proxy_state = st.proxy.clone();
        tokio::spawn(async move {
            let _ = tokio::signal::ctrl_c().await;
            info!("收到退出信号，正在停止代理进程...");
            let _ = proxy_manager::stop(proxy_state);
            std::process::exit(0);
        });
    }

    info!("shoes-admin v{} 启动中，监听 {}", env!("CARGO_PKG_VERSION"), listen);
    info!("提示: 关闭此窗口将停止服务（含代理进程）；浏览器访问 http://127.0.0.1:{}", port);

    let server_app_state = app_state.clone();
    let server = match HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(server_app_state.clone()))
            .wrap(middleware::Logger::default())
            .wrap(auth::Auth)
            .configure(routes::configure)
    })
    .bind(&listen)
    {
        Ok(s) => s,
        Err(e) => return Err(handle_bind_failure(&listen, port, &e)),
    };

    // Windows 发布版：自动打开浏览器
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    {
        let url = format!("http://127.0.0.1:{}", port);
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            if std::env::var("SHOES_ADMIN_NO_OPEN").is_err() {
                let _ = webbrowser::open(&url);
                info!("已自动打开浏览器: {}", url);
            }
        });
    }

    server.run().await
}
