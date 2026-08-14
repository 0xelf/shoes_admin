use std::fs::File;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use log::{error, info, warn};
use serde::Serialize;

use crate::app_state::{AppState, SharedState};
use crate::proxy_manager;

const REPO: &str = "cfal/shoes";
const UA: &str = "shoes-admin/0.1.0";

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    Idle,
    Checking,
    Downloading,
    Extracting,
    Done,
    Unsupported,
    Error,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct DownloadStatus {
    pub state: DownloadState,
    /// 目标 release 版本号
    pub version: Option<String>,
    /// 匹配到的资产文件名
    pub asset: Option<String>,
    /// 下载进度 0.0 - 1.0
    pub progress: f32,
    /// 已下载字节 / 总字节
    pub received: u64,
    pub total: u64,
    pub message: String,
    /// 二进制是否就绪
    pub binary_ready: bool,
}

impl DownloaderState {
    pub fn new() -> Self {
        Self { status: DownloadStatus {
            state: DownloadState::Idle,
            version: None,
            asset: None,
            progress: 0.0,
            received: 0,
            total: 0,
            message: String::new(),
            binary_ready: false,
        }}
    }

    pub fn status(&self) -> DownloadStatus {
        self.status.clone()
    }
}

pub struct DownloaderState {
    pub status: DownloadStatus,
}

/// 当前平台对应的 release 资产候选列表（依次尝试，优先 gnu）；空表示官方未提供
fn asset_candidates_for_platform() -> Vec<String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("linux", "x86_64") => vec![
            "shoes-x86_64-unknown-linux-gnu.tar.gz".into(),
            "shoes-x86_64-unknown-linux-musl.tar.gz".into(),
        ],
        ("linux", "aarch64") => vec![
            "shoes-aarch64-unknown-linux-gnu.tar.gz".into(),
            "shoes-aarch64-unknown-linux-musl.tar.gz".into(),
        ],
        ("macos", "x86_64") => vec!["shoes-x86_64-apple-darwin.tar.gz".into()],
        ("macos", "aarch64") => vec!["shoes-aarch64-apple-darwin.tar.gz".into()],
        (os, arch) => {
            warn!("平台 {}-{} 官方未提供预编译产物", os, arch);
            vec![]
        }
    }
}

/// 查询最新 release 的 tag_name
fn fetch_latest_tag() -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", REPO);
    let resp = ureq::get(&url)
        .set("User-Agent", UA)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("查询最新 release 失败: {}", e))?;
    let json: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("解析 release 响应失败: {}", e))?;
    json.get("tag_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "release 响应缺少 tag_name".into())
}

/// 在后台线程中执行下载任务（内部全部为阻塞 IO，不影响 tokio runtime）
fn run_download_task(state: &AppState) {
    let st = state.download.clone();
    let bin_dir = state.bin_dir.clone();
    let data_dir = state.data_dir.clone();

    std::thread::spawn(move || {
        let result = do_download(&st, &bin_dir, &data_dir);
        match result {
            Ok(version) => {
                let mut s = st.lock().unwrap();
                s.status.state = DownloadState::Done;
                s.status.version = Some(version.clone());
                s.status.progress = 1.0;
                s.status.binary_ready = proxy_manager::binary_exists(&bin_dir);
                s.status.message = "shoes 二进制就绪".into();
                info!("shoes 二进制下载完成: {}", version);
            }
            Err(err) => {
                let mut s = st.lock().unwrap();
                if s.status.state != DownloadState::Unsupported {
                    s.status.state = DownloadState::Error;
                    s.status.message = err.clone();
                    error!("shoes 下载失败: {}", err);
                }
            }
        }
    });
}

fn do_download(
    st: &Arc<Mutex<DownloaderState>>,
    bin_dir: &std::path::Path,
    _data_dir: &std::path::Path,
) -> Result<String, String> {
    let candidates = asset_candidates_for_platform();
    if candidates.is_empty() {
        let mut s = st.lock().unwrap();
        s.status.state = DownloadState::Unsupported;
        s.status.message = format!(
            "当前平台 ({}-{}) 官方未提供预编译产物，代理功能不可用",
            std::env::consts::OS,
            std::env::consts::ARCH
        );
        return Err(s.status.message.clone());
    }

    {
        let mut s = st.lock().unwrap();
        s.status.state = DownloadState::Checking;
        s.status.asset = Some(candidates[0].clone());
        s.status.message = "正在查询最新 release...".into();
        s.status.progress = 0.0;
    }

    let tag = fetch_latest_tag()?;

    {
        let mut s = st.lock().unwrap();
        s.status.version = Some(tag.clone());
        s.status.message = format!("发现最新版本 {}", tag);
    }

    // 依次尝试候选资产（Linux 先 gnu 后 musl），全部失败才报错
    let mut last_err = String::new();
    for asset in &candidates {
        if let Ok(mut s) = st.lock() {
            s.status.state = DownloadState::Checking;
            s.status.asset = Some(asset.clone());
            s.status.progress = 0.0;
            s.status.message = format!("正在下载 {} ...", asset);
        }
        match download_one(st, bin_dir, asset, &tag) {
            Ok(_) => {
                info!("使用资产 {} 下载成功", asset);
                return Ok(tag.clone());
            }
            Err(e) => {
                warn!("资产 {} 下载失败: {}", asset, e);
                last_err = e;
            }
        }
    }
    Err(last_err)
}

/// 下载单个资产并解压到 bin/
fn download_one(
    st: &Arc<Mutex<DownloaderState>>,
    bin_dir: &std::path::Path,
    asset: &str,
    tag: &str,
) -> Result<(), String> {
    // 下载
    let url = format!("https://github.com/{}/releases/download/{}/{}", REPO, tag, asset);
    let tmp_path = bin_dir.join(format!(".{}.part", asset));
    let resp = ureq::get(&url)
        .set("User-Agent", UA)
        .call()
        .map_err(|e| format!("下载 {} 失败: {}", asset, e))?;

    let total = resp
        .header("Content-Length")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    {
        let mut s = st.lock().unwrap();
        s.status.state = DownloadState::Downloading;
        s.status.total = total;
        s.status.received = 0;
        s.status.progress = 0.0;
        s.status.message = format!("正在下载 {} ...", asset);
    }

    let mut reader = resp.into_reader();
    let mut file = File::create(&tmp_path).map_err(|e| format!("创建临时文件失败: {}", e))?;
    let mut received: u64 = 0;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("下载中断: {}", e))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("写入临时文件失败: {}", e))?;
        received += n as u64;
        let p = if total > 0 {
            (received as f32 / total as f32).min(1.0)
        } else {
            0.0
        };
        if let Ok(mut s) = st.lock() {
            s.status.received = received;
            s.status.progress = p;
        }
    }
    drop(file);

    // 解压
    {
        let mut s = st.lock().unwrap();
        s.status.state = DownloadState::Extracting;
        s.status.message = "正在解压二进制...".into();
    }
    info!("解压 {} 到 bin/", asset);
    extract_binary(&tmp_path, &bin_dir.join("shoes"))
        .map_err(|e| format!("解压失败: {}", e))?;
    let _ = std::fs::remove_file(&tmp_path);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(bin_dir.join("shoes"), std::fs::Permissions::from_mode(0o755));
    }

    Ok(())
}

/// 从 tar.gz 中提取名为 shoes 的二进制
fn extract_binary(archive_path: &std::path::Path, out_path: &std::path::Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| e.to_string())?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);
    let mut entries = archive
        .entries()
        .map_err(|e| format!("读取压缩包失败: {}", e))?;
    while let Some(entry) = entries.next() {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name == "shoes" {
                let mut out = File::create(out_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
                std::io::copy(&mut entry, &mut out).map_err(|e| format!("写入二进制失败: {}", e))?;
                return Ok(());
            }
        }
    }
    Err("压缩包中未找到 shoes 二进制".into())
}

/// 首次启动检查：若二进制缺失则后台下载（不阻塞 HTTP 服务）
pub fn spawn_download_if_needed(state: SharedState) {
    if proxy_manager::binary_exists(&state.bin_dir) {
        info!("已检测到 shoes 二进制: {}", state.bin_dir.display());
        let mut s = state.download.lock().unwrap();
        s.status.state = DownloadState::Done;
        s.status.binary_ready = true;
        s.status.message = "shoes 二进制就绪".into();
        return;
    }
    info!("未检测到 shoes 二进制，后台开始下载...");
    run_download_task(state.as_ref());
}

/// 手动触发（重试 / 强制更新）
pub fn spawn_retry(state: &SharedState) {
    let mut s = state.download.lock().unwrap();
    *s = DownloaderState::new();
    drop(s);
    run_download_task(state);
}
