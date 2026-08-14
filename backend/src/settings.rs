use std::fs;
use std::path::Path;

use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use log::warn;
use rand::RngCore;
use serde::{Deserialize, Serialize};

/// 面板自身设置，持久化在 data/app.json
#[derive(Clone, Serialize, Deserialize)]
pub struct Settings {
    /// 服务监听地址
    pub listen: String,
    /// 管理员用户名
    pub username: String,
    /// Argon2id PHC 格式密码哈希
    pub password_hash: String,
    /// JWT 签名密钥
    pub jwt_secret: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            listen: "0.0.0.0:6240".into(),
            username: "admin".into(),
            password_hash: hash_password("admin"),
            jwt_secret: random_secret(),
        }
    }
}

impl Settings {
    pub fn load_or_default(data_dir: &Path) -> Self {
        let path = data_dir.join("app.json");
        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Settings>(&content) {
                Ok(s) => {
                    // 迁移兜底：缺失字段补默认值
                    let mut s = s;
                    if s.jwt_secret.is_empty() {
                        s.jwt_secret = random_secret();
                    }
                    if s.username.is_empty() {
                        s.username = "admin".into();
                    }
                    if s.password_hash.is_empty() {
                        s.password_hash = hash_password("admin");
                    }
                    let _ = s.save(data_dir);
                    s
                }
                Err(e) => {
                    warn!("app.json 解析失败({}), 使用默认设置", e);
                    let s = Settings::default();
                    let _ = s.save(data_dir);
                    s
                }
            },
            Err(_) => {
                let s = Settings::default();
                let _ = s.save(data_dir);
                s
            }
        }
    }

    pub fn save(&self, data_dir: &Path) -> std::io::Result<()> {
        let path = data_dir.join("app.json");
        let content = serde_json::to_string_pretty(self).map_err(|e| std::io::Error::other(e.to_string()))?;
        fs::write(path, content)
    }

    pub fn verify_password(&self, password: &str) -> bool {
        match PasswordHash::new(&self.password_hash) {
            Ok(parsed) => Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok(),
            Err(_) => false,
        }
    }

    pub fn set_password(&mut self, new_password: &str) {
        self.password_hash = hash_password(new_password);
    }
}

pub fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .unwrap_or_else(|_| String::new())
}

pub fn random_secret() -> String {
    let mut buf = [0u8; 48];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    base64_encode(&buf)
}

pub fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
