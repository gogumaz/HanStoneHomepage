# uzdream.com Nginx 배포 설정

이 디렉터리는 정적 웹 배포물과 `127.0.0.1:3000`의 API를 같은 도메인으로 제공하는
Nginx 운영 설정입니다. `bootstrap` 설정으로 HTTP를 먼저 열고 Certbot 인증서를 발급한
뒤 HTTPS 설정으로 교체합니다.

## 1. 전제 조건

- `uzdream.com`과 `www.uzdream.com`이 서버 공인 IP를 가리킵니다.
- 검증된 웹 산출물이 `/var/www/hanstone/current`에 배치돼 있습니다.
- Nginx와 Certbot이 설치돼 있습니다.
- API를 사용할 경우 Docker Compose가 API를 `127.0.0.1:3000`에만 게시합니다.

## 2. 설정 파일 전송

Windows PowerShell의 프로젝트 루트에서 실행합니다.

```powershell
scp -r .\deploy\nginx hanstone@SERVER_IP:/tmp/hanstone-nginx
```

SSH 포트가 다르면 `scp -P SSH_PORT ...` 형식을 사용합니다.

## 3. HTTP 부트스트랩 설치

서버 SSH 터미널에서 실행합니다.

```bash
sudo install -m 644 /tmp/hanstone-nginx/conf.d/hanstone-cache-map.conf \
  /etc/nginx/conf.d/hanstone-cache-map.conf
sudo install -m 644 /tmp/hanstone-nginx/snippets/hanstone-security-headers.conf \
  /etc/nginx/snippets/hanstone-security-headers.conf
sudo install -m 644 /tmp/hanstone-nginx/snippets/hanstone-api-proxy.conf \
  /etc/nginx/snippets/hanstone-api-proxy.conf
sudo install -m 644 /tmp/hanstone-nginx/sites-available/hanstone-bootstrap.conf \
  /etc/nginx/sites-available/hanstone
sudo ln -sfn /etc/nginx/sites-available/hanstone /etc/nginx/sites-enabled/hanstone
sudo unlink /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t`가 실패하면 reload하지 말고 표시된 파일과 줄 번호를 수정합니다.

## 4. 최초 인증서 발급

두 도메인의 HTTP 접속이 성공한 뒤 실행합니다.

```bash
sudo certbot certonly --nginx -d uzdream.com -d www.uzdream.com
sudo certbot renew --dry-run
```

인증서 발급이 끝나기 전에는 다음 HTTPS 설정을 설치하지 않습니다. 인증서 파일이 없는
상태에서 설치하면 `nginx -t`가 실패합니다.

## 5. 운영 HTTPS 설정 적용

```bash
sudo install -m 644 /tmp/hanstone-nginx/sites-available/hanstone.conf \
  /etc/nginx/sites-available/hanstone
sudo nginx -t
sudo systemctl reload nginx
```

## 6. 확인

```bash
curl -I http://uzdream.com
curl -I https://uzdream.com
curl -I https://uzdream.com/config.js
curl -I https://uzdream.com/assets/실제-해시-파일명.js
curl -fsS https://uzdream.com/api/v1/health/live
curl -fsS https://uzdream.com/api/v1/health/ready
```

정상 기준은 다음과 같습니다.

- HTTP 요청은 HTTPS로 `301` 이동합니다.
- HTTPS 응답에는 CSP, `X-Content-Type-Options`, `X-Frame-Options` 등 보안 헤더가 있습니다.
- `/assets/`의 해시 파일은 `public, max-age=31536000, immutable`입니다.
- HTML과 `config.js`는 `public, max-age=0, must-revalidate`입니다.
- `/api/`는 `no-store`이며 `live`와 `ready`가 모두 성공합니다.

운영 준비 상태 전체 점검은 상위 디렉터리의 `check-host-readiness.sh --mode full`을
사용합니다.
