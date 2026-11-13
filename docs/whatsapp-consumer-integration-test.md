# Optional WhatsApp backend integration test

The ordinary test suite runs the consumer unit tests without access to another repository. The HTTP backend integration test explicitly reports **skipped** unless `KONG_WHATSAPP_BACKEND_FIXTURE` is set. A skip is not a passing integration check.

To reproduce the integration check, obtain an authorized local checkout of the KONG backend outside this repository. Check out commit `daada94d52df2e6b008b59799d2db723215df0c5` and leave its `server` and `shared` sources unchanged. Do not copy private source or credentials into this project. Install this project's locked development dependencies, and ensure Git and Node are available on PATH.

In PowerShell, replace the path below with that checkout's absolute path:

```powershell
$env:KONG_WHATSAPP_BACKEND_FIXTURE = 'C:/authorized-checkouts/kong-backend'
node --import tsx --test tests/whatsapp-backend-consumer.test.ts
Remove-Item Env:KONG_WHATSAPP_BACKEND_FIXTURE
```

Once the variable is set, a blank/missing path, wrong revision, or modified backend source fails the test; none silently skips it. The fixture bundles the actual backend route with synthetic authentication and an in-memory store, binds only to loopback, and uses synthetic credentials. It does not call production, read WhatsApp, send messages, or require production secrets.
