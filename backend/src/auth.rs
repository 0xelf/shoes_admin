use std::future::{ready, Ready};
use std::pin::Pin;
use std::task::{Context, Poll};

use actix_web::body::MessageBody;
use actix_web::dev::{Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::error::ErrorUnauthorized;
use actix_web::{web, Error, HttpResponse};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::app_state::{ApiResp, SharedState};

const TOKEN_TTL_SECS: usize = 24 * 3600;

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

pub fn issue_token(secret: &str) -> String {
    let exp = chrono::Utc::now().timestamp() as usize + TOKEN_TTL_SECS;
    let claims = Claims { sub: "admin".into(), exp };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap_or_default()
}

fn validate_token(auth_header: &str, secret: &str) -> bool {
    let token = auth_header
        .strip_prefix("Bearer ")
        .or_else(|| auth_header.strip_prefix("bearer "))
        .unwrap_or(auth_header);
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .is_ok()
}

/// JWT 认证中间件：/api 下除 /api/auth/login 与 /api/health 外全部需要有效 token
pub struct Auth;

impl<S, B> Transform<S, ServiceRequest> for Auth
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = AuthMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(AuthMiddleware { service }))
    }
}

pub struct AuthMiddleware<S> {
    service: S,
}

impl<S, B> Service<ServiceRequest> for AuthMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = Pin<Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>>>>;

    fn poll_ready(&self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let path = req.path().to_string();
        let is_api = path.starts_with("/api/");
        let is_public = path == "/api/auth/login" || path == "/api/health";

        if !is_api || is_public {
            let fut = self.service.call(req);
            return Box::pin(async move { fut.await });
        }

        let auth_header = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let secret = req
            .app_data::<web::Data<SharedState>>()
            .map(|s| s.settings.lock().unwrap().jwt_secret.clone())
            .unwrap_or_default();

        if !auth_header.is_empty() && validate_token(&auth_header, &secret) {
            let fut = self.service.call(req);
            Box::pin(async move { fut.await })
        } else {
            Box::pin(async move {
                Err(ErrorUnauthorized(serde_json::to_string(&ApiResp::<()>::err(
                    "未登录或登录已过期",
                ))
                .unwrap_or_default()))
            })
        }
    }
}

// ---------- 认证相关 handler ----------

#[derive(Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
}

pub async fn login(state: web::Data<SharedState>, body: web::Json<LoginReq>) -> HttpResponse {
    let settings = state.settings.lock().unwrap();
    if body.username == settings.username && settings.verify_password(&body.password) {
        let token = issue_token(&settings.jwt_secret);
        HttpResponse::Ok().json(ApiResp::ok(
            "登录成功",
            serde_json::json!({
                "token": token,
                "username": settings.username,
                "expires_in": TOKEN_TTL_SECS,
            }),
        ))
    } else {
        HttpResponse::Unauthorized().json(ApiResp::<()>::err("用户名或密码错误"))
    }
}

#[derive(Deserialize)]
pub struct ChangePasswordReq {
    pub old_password: String,
    pub new_password: String,
}

pub async fn change_password(
    state: web::Data<SharedState>,
    body: web::Json<ChangePasswordReq>,
) -> HttpResponse {
    if body.new_password.len() < 6 {
        return HttpResponse::BadRequest().json(ApiResp::<()>::err("新密码长度至少 6 位"));
    }
    let mut settings = state.settings.lock().unwrap();
    if !settings.verify_password(&body.old_password) {
        return HttpResponse::Unauthorized().json(ApiResp::<()>::err("原密码错误"));
    }
    settings.set_password(&body.new_password);
    match settings.save(&state.data_dir) {
        Ok(_) => HttpResponse::Ok().json(ApiResp::ok_void("密码修改成功")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResp::<()>::err(format!("保存失败: {}", e))),
    }
}
