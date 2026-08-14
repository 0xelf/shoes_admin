use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use log::{info, warn};
use serde::Serialize;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;

use crate::app_state::AppState;

const LOG_CAPACITY: usize = 2000;

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyState {
    Stopped,
    Starting,
    Running,
    Exited,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct ProxyStatus {
    pub state: ProxyState,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
    pub last_error: Option<String>,
    pub log_count: usize,
}

/// shoes 代理子进程管理
pub struct ProxyManager {
    pub child: Option<tokio::process::Child>,
    pub pid: Option<u32>,
    pub state: ProxyState,
    pub started_at: Option<i64>,
    pub last_error: Option<String>,
    pub log_buffer: VecDeque<String>,
}

impl ProxyManager {
    pub fn new() -> Self {
        Self {
            child: None,
            pid: None,
            state: ProxyState::Stopped,
            started_at: None,
            last_error: None,
            log_buffer: VecDeque::with_capacity(LOG_CAPACITY),
        }
    }

    pub fn status(&self) -> ProxyStatus {
        ProxyStatus {
            state: self.state.clone(),
            pid: self.pid,
            started_at: self.started_at,
            last_error: self.last_error.clone(),
            log_count: self.log_buffer.len(),
        }
    }

    pub fn push_log(&mut self, line: String) {
        if self.log_buffer.len() >= LOG_CAPACITY {
            self.log_buffer.pop_front();
        }
        self.log_buffer.push_back(line);
    }

    pub fn recent_logs(&self, lines: usize) -> Vec<String> {
        let skip = self.log_buffer.len().saturating_sub(lines.max(1));
        self.log_buffer.iter().skip(skip).cloned().collect()
    }
}

/// 启动 shoes 进程（调用方需先确认二进制存在）
pub async fn start(state: &AppState) -> Result<(), String> {
    let bin_path = state.bin_dir.join(binary_name());
    if !bin_path.exists() {
        return Err(format!("未找到代理二进制: {}", bin_path.display()));
    }
    let cfg_path = state.data_dir.join("config.yaml");
    if !cfg_path.exists() {
        return Err("配置文件缺失，请先在配置页保存配置".into());
    }

    {
        let pm = state.proxy.lock().unwrap();
        if pm.state == ProxyState::Running || pm.state == ProxyState::Starting {
            return Err("代理已在运行中".into());
        }
    }

    info!("启动 shoes: {} {}", bin_path.display(), cfg_path.display());
    let mut child = Command::new(&bin_path)
        .arg(&cfg_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("启动进程失败: {}", e))?;

    let pid = child.id();
    let out = child.stdout.take().ok_or("无法获取 stdout")?;
    let err = child.stderr.take().ok_or("无法获取 stderr")?;

    {
        let mut pm = state.proxy.lock().unwrap();
        pm.child = Some(child);
        pm.pid = pid;
        pm.state = ProxyState::Starting;
        pm.started_at = Some(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0));
        pm.last_error = None;
    }

    let shared = Arc::new(state.proxy.clone());
    let shared2 = shared.clone();

    // stdout 读循环
    tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(out).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(mut pm) = shared.lock() {
                pm.push_log(line);
            }
        }
    });

    // stderr 读循环
    tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(err).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(mut pm) = shared2.lock() {
                pm.push_log(format!("[stderr] {}", line));
            }
        }
    });

    // 退出监听
    let st = Arc::new(state.proxy.clone());
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let mut exited = None;
            {
                if let Ok(mut pm) = st.lock() {
                    if let Some(c) = pm.child.as_mut() {
                        if let Ok(Some(status)) = c.try_wait() {
                            exited = Some(status);
                        }
                    }
                }
            }
            if let Some(status) = exited {
                if let Ok(mut pm) = st.lock() {
                    pm.child = None;
                    pm.pid = None;
                    pm.state = ProxyState::Exited;
                    pm.last_error = Some(format!("代理进程已退出 (code={:?})", status.code()));
                    warn!("shoes 进程退出: {:?}", status.code());
                }
                break;
            }
        }
    });

    // 短暂等待，确认进程没有立即崩溃
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    {
        let mut pm = state.proxy.lock().unwrap();
        if pm.state == ProxyState::Starting {
            pm.state = ProxyState::Running;
        }
    }

    Ok(())
}

/// 停止 shoes 进程
pub fn stop(proxy_state: Arc<Mutex<ProxyManager>>) -> Result<(), String> {
    let mut pm = proxy_state.lock().unwrap();
    if let Some(mut child) = pm.child.take() {
        #[cfg(unix)]
        {
            if let Some(p) = pm.pid {
                unsafe {
                    libc::kill(p as i32, libc::SIGTERM);
                }
            }
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill();
        }
        // 等待最多 3 秒优雅退出
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if let Ok(Some(_)) = child.try_wait() {
                break;
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    pm.child = None;
    pm.pid = None;
    pm.state = ProxyState::Stopped;
    pm.last_error = None;
    info!("shoes 代理已停止");
    Ok(())
}

pub fn clear_logs(state: &AppState) {
    let mut pm = state.proxy.lock().unwrap();
    pm.log_buffer.clear();
}

pub fn binary_name() -> &'static str {
    if cfg!(windows) {
        "shoes.exe"
    } else {
        "shoes"
    }
}

pub fn binary_exists(bin_dir: &Path) -> bool {
    bin_dir.join(binary_name()).exists()
}
