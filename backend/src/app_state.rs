use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::{config_store::ConfigStore, downloader::DownloaderState, proxy_manager::ProxyManager, settings::Settings};

/// 全局应用状态
pub struct AppState {
    pub base_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub settings: Arc<Mutex<Settings>>,
    pub config: Arc<Mutex<ConfigStore>>,
    pub proxy: Arc<Mutex<ProxyManager>>,
    pub download: Arc<Mutex<DownloaderState>>,
}

pub type SharedState = Arc<AppState>;

impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            base_dir: self.base_dir.clone(),
            bin_dir: self.bin_dir.clone(),
            data_dir: self.data_dir.clone(),
            settings: self.settings.clone(),
            config: self.config.clone(),
            proxy: self.proxy.clone(),
            download: self.download.clone(),
        }
    }
}

/// 统一 API 响应结构
#[derive(serde::Serialize)]
pub struct ApiResp<T> {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

impl<T> ApiResp<T> {
    pub fn ok(message: impl Into<String>, data: T) -> Self {
        Self { ok: true, message: message.into(), data: Some(data) }
    }
    pub fn err(message: impl Into<String>) -> Self {
        Self { ok: false, message: message.into(), data: None }
    }
}

impl ApiResp<()> {
    pub fn ok_void(message: impl Into<String>) -> Self {
        Self { ok: true, message: message.into(), data: None }
    }
}

/// 当前平台信息
pub fn platform_info() -> (String, String, bool) {
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let supported = matches!(os.as_str(), "linux" | "macos");
    (os, arch, supported)
}
