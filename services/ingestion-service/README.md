# Ingestion Service

A minimal Fastify service that enqueues ingestion requests to a Redis Stream.

- Health: `GET /ingestion/health`
- Enqueue: `POST /ingestion/start`

Environment variables
- `INGESTION_SERVICE_HOST` (default: `0.0.0.0`)
- `INGESTION_SERVICE_PORT` (default: `4010`)
- `REDIS_URL` (default: `redis://redis:6379`)
- `INGEST_STREAM` (default: `ingest.request`)

Docker Compose
This service is wired in `infra/docker-compose.yml` as `ingestion-service` and depends on the `redis` service.

Validate locally (curl)
1) Health check

```
curl -s -i http://localhost:4010/ingestion/health
```

2) Enqueue an ingestion request (sends a JSON payload to the Redis stream)

```
curl -s -i \
  -H 'content-type: application/json' \
  -H 'x-request-id: demo-req-1' \
  -d '{"source":"manual","doc_id":"abc123"}' \
  http://localhost:4010/ingestion/start
```

You should receive `{ ok: true, enqueued: true }` on success.

Inspect the Redis stream (optional)
If you have the stack running with Docker Compose:

```
docker exec -it talvra_redis redis-cli XREAD COUNT 5 STREAMS ingest.request 0-0
```

You should see entries with field `json` that contains the enqueued payload (including `request_id` and `ts`).
