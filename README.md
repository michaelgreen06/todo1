# Todo MVP

## Local setup

```bash
cd todo1
npm install
npm run check
npm test
```

The SQLite database path is read from `TODO_DATABASE_PATH`. If the variable is
unset, the app uses `todo.sqlite` in the current directory.

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

## Android emulator

The server listens on the host loopback interface. For an Android emulator or an
ADB-connected device, forward the port and keep using `http://localhost:3000`:

```bash
adb reverse tcp:3000 tcp:3000
```
