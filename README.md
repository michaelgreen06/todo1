# Todo MVP

## Local setup

```bash
cd todo1
npm install
npm run check
npm test
```

## Local environment

Use these variables for local runs and for Railway prep:

```bash
HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000
TODO_DATABASE_PATH=todo.sqlite
```

`HOST` defaults to `127.0.0.1`, `PORT` defaults to `3000`, and
`TODO_DATABASE_PATH` defaults to `todo.sqlite`. `PUBLIC_BASE_URL` is optional
locally. Set it in production so magic links use the public HTTPS URL and
session cookies are marked `Secure`.

Create a bearer token for a capture device:

```bash
npm run create-device-token -- user@example.com "Michael phone"
```

The command prints the raw token once. Store it on the device immediately. The
database stores only its hash, so the raw token cannot be recovered later.

Start the server:

```bash
npm start
```

## Capture API

Send a capture with the device token:

```bash
curl -i http://localhost:3000/items \
  -H 'Authorization: Bearer <raw-device-token>' \
  -H 'Content-Type: application/json' \
  --data '{
    "client_capture_id": "75c88b9c-c566-4bf6-9215-657e47d0e4de",
    "text": "Pick up dry cleaning",
    "captured_at": "2026-05-31T12:00:00Z",
    "metadata": {"source": "android"}
  }'
```

The server responds with `201 Created`:

```json
{
  "capture_id": "<capture-id>",
  "routed_item_id": "<item-id>",
  "duplicate": false
}
```

Replaying a request with the same `client_capture_id` also returns `201 Created`
with the original IDs and no new item:

```json
{
  "capture_id": "<same-capture-id>",
  "routed_item_id": "<same-item-id>",
  "duplicate": true
}
```

## Railway deployment

Install and authenticate the Railway CLI:

```bash
brew install railway
railway login
```

Link this directory to the target Railway project and service:

```bash
cd /Users/michaelgreen/dev_stuff/voice-agent/todo1
railway link
```

Deploy your own code from this directory:

```bash
railway up
```

`railway deploy` is for templates such as Postgres. For your app code, use
`railway up`.

### Remote volume

Create a persistent volume and attach it at `/data`:

```bash
railway volume add --service todo1 --mount-path /data
```

Then set the SQLite path to the mounted volume:

```bash
railway variable set TODO_DATABASE_PATH=/data/todo.sqlite
```

### Remote environment variables

Set the deployment variables on the service:

```bash
railway variable set HOST=0.0.0.0
railway variable set PUBLIC_BASE_URL=https://<your-domain>
railway variable set TODO_DATABASE_PATH=/data/todo.sqlite
```

Railway injects `PORT` at runtime. Variable changes are staged in Railway and
then applied by deploying again:

```bash
railway up
```

### Remote domain

Generate a Railway domain:

```bash
railway domain
```

Add a custom domain later:

```bash
railway domain todo.example.com
```

Railway will print the DNS records you must add.

### Remote token provisioning

After the service is live and the volume is attached, create a device token in
the deployed container:

```bash
railway ssh
node dist/create-device-token.js user@example.com "Michael phone"
```

Or as one command:

```bash
railway ssh node dist/create-device-token.js user@example.com "Michael phone"
```

Copy the raw token immediately. Same story as local: only the hash is stored.

### Log-based login retrieval

Magic-link login URLs are printed to application logs. Tail logs and look for
the `Magic login link for ...` line after you submit the login form:

```bash
railway logs
```

Open the printed URL in your browser and finish login there.

### Serverless sleeping and the $1 hard limit

For cheapo mode, very nice:

1. In the Railway dashboard, open the service settings and enable Serverless
   sleeping so the service can sleep when inactive.
2. In the dashboard, open the workspace Usage page.
3. Click `Set Usage Limits`.
4. Set a compute `Hard limit` to `$1` if this project is meant to stay inside
   the Free plan credit.
5. Optionally set a lower email alert first, so you get warning before full
   stop like man who hear train before train become in face.

## Android emulator

The server listens on the host loopback interface. For an Android emulator or an
ADB-connected device, forward the port and keep using `http://localhost:3000`:

```bash
adb reverse tcp:3000 tcp:3000
```

## Later phone-whisper handoff

When you wire the Android side later:

1. Fill the `phone-whisper` `.env` with the deployed base URL and the raw device
   token created above.
2. Run:

   ```bash
   make test
   make build
   ```

3. Stop here until the phone is connected. Install the configured APK later
   with `make adb-reinstall`. The deployed HTTPS URL does not need ADB reverse.
