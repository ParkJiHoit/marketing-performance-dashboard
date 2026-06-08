# Naver SA Dashboard

## API Server

Run the Node server to use the Naver SA dashboard:

```powershell
node server\naverSaApiServer.js
```

The server automatically loads credentials from `.env.local`. Use `.env.example` as the template for new environments.

Then open:

```text
http://localhost:4173/#naver-sa
```

## API Security

Naver Search Ad credentials are read only in `server/naverSearchAdClient.js`.
The frontend never receives `NAVER_ACCESS_LICENSE` or `NAVER_SECRET_KEY`.

The signature utility signs:

```text
timestamp.method.uri
```

with HMAC-SHA256 and Base64 encoding.

## Conversion Tracking Caveat

If the account has not enabled conversion tracking, conversion, CPA, ROAS, and conversion-rate widgets may show `전환 없음`.
The recommendation logic avoids labeling zero-conversion rows as final failures when click/impression volume is still low.
