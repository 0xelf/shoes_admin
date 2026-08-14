use std::fs;
use std::path::Path;

use log::warn;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

/// 结构化配置文档（data/config.json），是可视化编辑的数据源
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ConfigDoc {
    pub version: u32,
    pub entries: Vec<ConfigEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "mode")]
pub enum ConfigEntry {
    /// 可视化表单条目
    #[serde(rename = "visual")]
    Visual {
        id: String,
        name: String,
        enabled: bool,
        address: String,
        transport: String,
        protocol: Protocol,
        quic_settings: Option<serde_json::Value>,
        rules_yaml: Option<String>,
    },
    /// 高级 YAML 直编条目
    #[serde(rename = "yaml")]
    Yaml {
        id: String,
        name: String,
        enabled: bool,
        yaml: String,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum Protocol {
    #[serde(rename = "http")]
    Http { username: Option<String>, password: Option<String> },
    #[serde(rename = "socks")]
    Socks {
        username: Option<String>,
        password: Option<String>,
        udp_enabled: Option<bool>,
    },
    #[serde(rename = "mixed")]
    Mixed {
        username: Option<String>,
        password: Option<String>,
        udp_enabled: Option<bool>,
    },
    #[serde(rename = "shadowsocks")]
    Shadowsocks { cipher: String, password: String },
    #[serde(rename = "vmess")]
    Vmess {
        cipher: Option<String>,
        user_id: String,
        udp_enabled: Option<bool>,
    },
    #[serde(rename = "vless")]
    Vless { user_id: String, udp_enabled: Option<bool> },
    #[serde(rename = "trojan")]
    Trojan { password: String },
    #[serde(rename = "hysteria2")]
    Hysteria2 { password: String, udp_enabled: Option<bool> },
    #[serde(rename = "tuic")]
    Tuic { uuid: String, password: String },
    #[serde(rename = "anytls")]
    AnyTLS {
        users: Vec<AnyTlsUser>,
        udp_enabled: Option<bool>,
    },
    #[serde(rename = "naiveproxy")]
    NaiveProxy {
        users: Vec<NaiveUser>,
        padding: Option<bool>,
    },
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AnyTlsUser {
    pub name: Option<String>,
    pub password: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct NaiveUser {
    pub name: Option<String>,
    pub username: String,
    pub password: String,
}

/// 配置存储：负责 JSON 持久化 + 生成 shoes 的 YAML 配置
pub struct ConfigStore {
    pub doc: ConfigDoc,
}

fn y(key: &str) -> Value {
    Value::String(key.to_string())
}

fn json_to_yaml(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Number(i.into())
            } else if let Some(u) = n.as_u64() {
                Value::Number(u.into())
            } else {
                Value::Number(n.as_f64().unwrap_or(0.0).into())
            }
        }
        serde_json::Value::String(s) => Value::String(s.clone()),
        serde_json::Value::Array(a) => Value::Sequence(a.iter().map(json_to_yaml).collect()),
        serde_json::Value::Object(o) => {
            let mut m = Mapping::new();
            for (k, val) in o {
                m.insert(y(k), json_to_yaml(val));
            }
            Value::Mapping(m)
        }
    }
}

fn protocol_to_yaml(p: &Protocol) -> Mapping {
    let mut m = Mapping::new();
    match p {
        Protocol::Http { username, password } => {
            m.insert(y("type"), y("http"));
            if let Some(u) = username.as_ref().filter(|s| !s.is_empty()) {
                m.insert(y("username"), y(u));
            }
            if let Some(pw) = password.as_ref().filter(|s| !s.is_empty()) {
                m.insert(y("password"), y(pw));
            }
        }
        Protocol::Socks { username, password, udp_enabled } => {
            m.insert(y("type"), y("socks"));
            if let Some(u) = username.as_ref().filter(|s| !s.is_empty()) {
                m.insert(y("username"), y(u));
            }
            if let Some(pw) = password.as_ref().filter(|s| !s.is_empty()) {
                m.insert(y("password"), y(pw));
            }
            if let Some(v) = udp_enabled {
                m.insert(y("udp_enabled"), Value::Bool(*v));
            }
        }
        Protocol::Mixed { username, password, udp_enabled } => {
            m.insert(y("type"), y("mixed"));
            if let Some(u) = username.as_ref().filter(|s| !s.is_empty()) {
                m.insert(y("username"), y(u));
            }
            if let Some(pw) = password.as_ref().filter(|s| !s.is_empty()) {
                m.insert(y("password"), y(pw));
            }
            if let Some(v) = udp_enabled {
                m.insert(y("udp_enabled"), Value::Bool(*v));
            }
        }
        Protocol::Shadowsocks { cipher, password } => {
            m.insert(y("type"), y("shadowsocks"));
            m.insert(y("cipher"), y(cipher));
            m.insert(y("password"), y(password));
        }
        Protocol::Vmess { cipher, user_id, udp_enabled } => {
            m.insert(y("type"), y("vmess"));
            m.insert(y("user_id"), y(user_id));
            if let Some(c) = cipher.as_ref().filter(|s| !s.is_empty()) {
                m.insert(y("cipher"), y(c));
            }
            if let Some(v) = udp_enabled {
                m.insert(y("udp_enabled"), Value::Bool(*v));
            }
        }
        Protocol::Vless { user_id, udp_enabled } => {
            m.insert(y("type"), y("vless"));
            m.insert(y("user_id"), y(user_id));
            if let Some(v) = udp_enabled {
                m.insert(y("udp_enabled"), Value::Bool(*v));
            }
        }
        Protocol::Trojan { password } => {
            m.insert(y("type"), y("trojan"));
            m.insert(y("password"), y(password));
        }
        Protocol::Hysteria2 { password, udp_enabled } => {
            m.insert(y("type"), y("hysteria2"));
            m.insert(y("password"), y(password));
            if let Some(v) = udp_enabled {
                m.insert(y("udp_enabled"), Value::Bool(*v));
            }
        }
        Protocol::Tuic { uuid, password } => {
            m.insert(y("type"), y("tuic"));
            m.insert(y("uuid"), y(uuid));
            m.insert(y("password"), y(password));
        }
        Protocol::AnyTLS { users, udp_enabled } => {
            m.insert(y("type"), y("anytls"));
            let seq: Vec<Value> = users
                .iter()
                .map(|u| {
                    let mut um = Mapping::new();
                    if let Some(n) = u.name.as_ref().filter(|s| !s.is_empty()) {
                        um.insert(y("name"), y(n));
                    }
                    um.insert(y("password"), y(&u.password));
                    Value::Mapping(um)
                })
                .collect();
            m.insert(y("users"), Value::Sequence(seq));
            if let Some(v) = udp_enabled {
                m.insert(y("udp_enabled"), Value::Bool(*v));
            }
        }
        Protocol::NaiveProxy { users, padding } => {
            m.insert(y("type"), y("naiveproxy"));
            let seq: Vec<Value> = users
                .iter()
                .map(|u| {
                    let mut um = Mapping::new();
                    if let Some(n) = u.name.as_ref().filter(|s| !s.is_empty()) {
                        um.insert(y("name"), y(n));
                    }
                    um.insert(y("username"), y(&u.username));
                    um.insert(y("password"), y(&u.password));
                    Value::Mapping(um)
                })
                .collect();
            m.insert(y("users"), Value::Sequence(seq));
            if let Some(v) = padding {
                m.insert(y("padding"), Value::Bool(*v));
            }
        }
    }
    m
}

impl ConfigStore {
    pub fn load_or_default(data_dir: &Path) -> Self {
        let json_path = data_dir.join("config.json");
        let doc = match fs::read_to_string(&json_path) {
            Ok(content) => match serde_json::from_str::<ConfigDoc>(&content) {
                Ok(d) => d,
                Err(e) => {
                    warn!("config.json 解析失败({}), 使用默认配置", e);
                    ConfigDoc::default_doc()
                }
            },
            Err(_) => ConfigDoc::default_doc(),
        };
        let store = Self { doc };
        // 确保 YAML 已生成
        let _ = store.save(data_dir);
        store
    }

    /// 持久化 JSON 并重新生成 YAML
    pub fn save(&self, data_dir: &Path) -> std::io::Result<()> {
        fs::write(
            data_dir.join("config.json"),
            serde_json::to_string_pretty(&self.doc)
                .map_err(|e| std::io::Error::other(e.to_string()))?,
        )?;
        fs::write(data_dir.join("config.yaml"), self.generate_yaml())
    }

    /// 由结构化文档生成 shoes 的 YAML 配置
    pub fn generate_yaml(&self) -> String {
        let mut docs: Vec<Value> = Vec::new();
        for entry in &self.doc.entries {
            match entry {
                ConfigEntry::Visual {
                    enabled: true,
                    address,
                    transport,
                    protocol,
                    quic_settings,
                    rules_yaml,
                    ..
                } => {
                    let mut m = Mapping::new();
                    m.insert(y("address"), y(address));
                    if let Some(q) = quic_settings {
                        if !q.is_null() {
                            m.insert(y("transport"), y("quic"));
                            m.insert(y("quic_settings"), json_to_yaml(q));
                        }
                    } else if transport == "quic" {
                        m.insert(y("transport"), y("quic"));
                    }
                    m.insert(y("protocol"), Value::Mapping(protocol_to_yaml(protocol)));
                    if let Some(r) = rules_yaml {
                        let trimmed = r.trim();
                        if !trimmed.is_empty() {
                            if let Ok(parsed) = serde_yaml::from_str::<Value>(trimmed) {
                                m.insert(y("rules"), parsed);
                            } else {
                                warn!("rules_yaml 解析失败，已忽略: {}", trimmed);
                            }
                        }
                    }
                    docs.push(Value::Mapping(m));
                }
                ConfigEntry::Yaml { enabled: true, yaml, .. } => {
                    let trimmed = yaml.trim();
                    if !trimmed.is_empty() {
                        match serde_yaml::from_str::<Value>(trimmed) {
                            Ok(Value::Sequence(seq)) => docs.extend(seq),
                            Ok(other) => docs.push(other),
                            Err(e) => warn!("YAML 条目解析失败，已跳过: {}", e),
                        }
                    }
                }
                _ => {}
            }
        }
        let body = serde_yaml::to_string(&Value::Sequence(docs)).unwrap_or_default();
        format!("# Generated by shoes-admin - 请勿手动修改，修改请在管理面板中进行\n{}", body)
    }
}

impl ConfigDoc {
    /// 默认示例配置：HTTP / SOCKS5 / Mixed 三种协议各一条可正常应用的配置
    pub fn default_doc() -> Self {
        Self {
            version: 1,
            entries: vec![
                ConfigEntry::Visual {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: "HTTP 代理".into(),
                    enabled: true,
                    address: "0.0.0.0:8080".into(),
                    transport: "tcp".into(),
                    protocol: Protocol::Http {
                        username: None,
                        password: None,
                    },
                    quic_settings: None,
                    rules_yaml: None,
                },
                ConfigEntry::Visual {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: "SOCKS5 代理".into(),
                    enabled: true,
                    address: "0.0.0.0:1080".into(),
                    transport: "tcp".into(),
                    protocol: Protocol::Socks {
                        username: None,
                        password: None,
                        udp_enabled: Some(true),
                    },
                    quic_settings: None,
                    rules_yaml: None,
                },
                ConfigEntry::Visual {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: "Mixed HTTP/SOCKS5".into(),
                    enabled: true,
                    address: "0.0.0.0:7890".into(),
                    transport: "tcp".into(),
                    protocol: Protocol::Mixed {
                        username: None,
                        password: None,
                        udp_enabled: Some(true),
                    },
                    quic_settings: None,
                    rules_yaml: None,
                },
            ],
        }
    }
}

/// 校验可视化条目，返回错误信息
pub fn validate_entry(entry: &ConfigEntry) -> Result<(), String> {
    match entry {
        ConfigEntry::Visual { address, protocol, .. } => {
            if address.trim().is_empty() {
                return Err("监听地址不能为空".into());
            }
            match protocol {
                Protocol::Http { .. } | Protocol::Socks { .. } | Protocol::Mixed { .. } => Ok(()),
                Protocol::Shadowsocks { password, .. } => {
                    if password.is_empty() {
                        Err("SS 密码不能为空".into())
                    } else {
                        Ok(())
                    }
                }
                Protocol::Vmess { user_id, .. } | Protocol::Vless { user_id, .. } => {
                    if user_id.is_empty() {
                        Err("用户 UUID 不能为空".into())
                    } else {
                        Ok(())
                    }
                }
                Protocol::Trojan { password } => {
                    if password.is_empty() {
                        Err("Trojan 密码不能为空".into())
                    } else {
                        Ok(())
                    }
                }
                Protocol::Hysteria2 { password, .. } => {
                    if password.is_empty() {
                        Err("Hysteria2 密码不能为空".into())
                    } else {
                        Ok(())
                    }
                }
                Protocol::Tuic { uuid, password } => {
                    if uuid.is_empty() {
                        Err("TUIC UUID 不能为空".into())
                    } else if password.is_empty() {
                        Err("TUIC 密码不能为空".into())
                    } else {
                        Ok(())
                    }
                }
                Protocol::AnyTLS { users, .. } => {
                    if users.is_empty() || users.iter().any(|u| u.password.is_empty()) {
                        Err("AnyTLS 至少需要一个有效用户".into())
                    } else {
                        Ok(())
                    }
                }
                Protocol::NaiveProxy { users, .. } => {
                    if users.is_empty()
                        || users.iter().any(|u| u.username.is_empty() || u.password.is_empty())
                    {
                        Err("NaiveProxy 至少需要一个有效用户".into())
                    } else {
                        Ok(())
                    }
                }
            }
        }
        ConfigEntry::Yaml { yaml, .. } => {
            if yaml.trim().is_empty() {
                return Err("YAML 内容不能为空".into());
            }
            match serde_yaml::from_str::<Value>(yaml.trim()) {
                Ok(_) => Ok(()),
                Err(e) => Err(format!("YAML 语法错误: {}", e)),
            }
        }
    }
}

/// 持久化并返回生成后的 YAML（供 handler 调用）
pub fn save_and_generate(store: &ConfigStore, data_dir: &Path) -> Result<String, String> {
    store
        .save(data_dir)
        .map(|_| store.generate_yaml())
        .map_err(|e| format!("写入配置文件失败: {}", e))
}
