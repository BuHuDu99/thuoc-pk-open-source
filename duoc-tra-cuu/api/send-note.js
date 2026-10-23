const RECIPIENT = process.env.NOTE_RECIPIENT || ''

const sendJson = (response, status, body) => {
  response.status(status)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

const parseBody = (body) => {
  if (typeof body === 'string') return JSON.parse(body)
  return body
}

const extractInlineImages = (html) => {
  const inlineImages = []
  const htmlBody = html.replace(/<img\b([^>]*?)src=["']data:(image\/(?:jpeg|png|webp));base64,([^"']+)["']([^>]*)>/gi, (_match, before, mimeType, base64, after) => {
    const cid = `note-image-${inlineImages.length + 1}`
    inlineImages.push({ cid, mimeType, base64, name: `${cid}.${mimeType.split('/')[1].replace('jpeg', 'jpg')}` })
    return `<img${before}src="cid:${cid}"${after}>`
  })
  return { htmlBody, inlineImages }
}

const sanitizeEmailHtml = (html) => html
  .replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
  .replace(/\sstyle\s*=\s*(["']).*?\1/gi, '')

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return sendJson(response, 405, { message: 'Phương thức không được hỗ trợ.' })
  }

  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL
  if (!scriptUrl) {
    return sendJson(response, 503, { message: 'Chức năng Gmail chưa được cấu hình.' })
  }

  try {
    const body = parseBody(request.body)
    const patientName = typeof body?.patientName === 'string' ? body.patientName.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    const contentHtml = typeof body?.contentHtml === 'string' ? body.contentHtml.trim() : ''
    const createdAt = typeof body?.createdAt === 'string' ? body.createdAt : ''
    const updatedAt = typeof body?.updatedAt === 'string' ? body.updatedAt : ''

    if (!patientName || (!content && !contentHtml) || patientName.length > 200 || content.length > 12000 || contentHtml.length > 2_400_000) {
      return sendJson(response, 400, { message: 'Tên bệnh nhân hoặc nội dung ghi chú không hợp lệ.' })
    }

    const timestamp = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(updatedAt || createdAt || Date.now()))

    const { htmlBody, inlineImages } = extractInlineImages(sanitizeEmailHtml(contentHtml || content.replace(/\n/g, '<br>')))
    const totalImageSize = inlineImages.reduce((total, image) => total + image.base64.length, 0)
    if (inlineImages.length > 2 || totalImageSize > 1_600_000) {
      return sendJson(response, 400, { message: 'Ảnh trong ghi chú quá lớn để gửi.' })
    }

    const scriptResponse = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientName, content: content || '[Ghi chú gồm hình ảnh]', htmlBody, inlineImages, timestamp }),
      redirect: 'follow',
    })
    const result = await scriptResponse.json().catch(() => null)

    if (!scriptResponse.ok || !result?.ok) throw new Error('Apps Script send failed')
    return sendJson(response, 200, { ok: true, recipient: RECIPIENT })
  } catch {
    return sendJson(response, 500, { message: 'Không thể gửi Gmail. Vui lòng thử lại.' })
  }
}
