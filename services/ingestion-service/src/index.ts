import Fastify from 'fastify'
import Redis from 'ioredis'

const app = Fastify({ logger: { level: 'info' } })

// Env
const HOST = process.env.INGESTION_SERVICE_HOST ?? '0.0.0.0'
const PORT = Number(process.env.INGESTION_SERVICE_PORT ?? 4010)
const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379'
const STREAM = process.env.INGEST_STREAM ?? 'ingest.request'

const redis = new Redis(REDIS_URL)

app.get('/ingestion/health', async () => ({ ok: true }))

app.post('/ingestion/start', async (req, reply) => {
  const id = (req.headers['x-request-id'] as string) || req.id
  const payload = (req.body ?? {}) as any
  const msg = {
    request_id: id,
    ts: new Date().toISOString(),
    ...payload,
  }
  try {
    await redis.xadd(STREAM, '*', 'json', JSON.stringify(msg))
    return { ok: true, enqueued: true }
  } catch (e) {
    req.log.error({ err: e }, 'enqueue failed')
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'enqueue failed' } })
  }
})

app.addHook('onClose', async () => {
  await redis.quit()
})

app
  .listen({ host: HOST, port: PORT })
  .then(() => app.log.info(`Ingestion service listening on ${HOST}:${PORT}, redis=${REDIS_URL}, stream=${STREAM}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
