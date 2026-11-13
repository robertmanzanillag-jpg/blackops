# secrets

Esta carpeta es para drop-in local de credenciales OAuth o archivos .env que Clippers puede detectar por nombre.

Reglas:

- No pegues valores secretos en chat.
- No commits de credenciales reales; .gitignore ignora todo aqui excepto este README.
- Puedes poner archivos como `client_secret_google.json`, `google-oauth-client.json`, `clippers-social-secrets.json`, `google-drive-keys.txt` o `.env.clippers.local`.
- Los archivos `.txt`, `.env` y `.local` pueden usar lineas `KEY=value`; los JSON de Google Cloud o JSON con env vars permitidas/key-value pairs tambien se importan.
- Luego abre Clippers > Credential Setup y usa Preview/Save batch para importar de forma controlada.
- El scanner solo muestra nombres/rutas de candidatos; no lee ni imprime valores.
