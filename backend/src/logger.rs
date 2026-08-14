use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use log::{Level, LevelFilter, Metadata, Record};

/// 简易文件日志：同时输出到 stderr（有控制台时可见）和 data/logs/admin.log
pub struct FileLogger {
    file: Mutex<File>,
}

impl FileLogger {
    pub fn init(path: &Path) -> Result<(), String> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| format!("打开日志文件失败: {}", e))?;
        let logger = FileLogger {
            file: Mutex::new(file),
        };
        log::set_boxed_logger(Box::new(logger))
            .map_err(|e| format!("初始化日志器失败: {}", e))?;
        log::set_max_level(LevelFilter::Info);
        Ok(())
    }
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= Level::Info
    }

    fn log(&self, record: &Record) {
        let line = format!(
            "[{}] [{}] {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            record.level(),
            record.args()
        );
        // 有控制台时同时打印（release 双击场景下无控制台，自动丢弃）
        eprint!("{}", line);
        if let Ok(mut f) = self.file.lock() {
            let _ = f.write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Ok(mut f) = self.file.lock() {
            let _ = f.flush();
        }
    }
}
