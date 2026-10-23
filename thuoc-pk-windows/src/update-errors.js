// electron-updater wraps a missing latest.yml in a channel-specific error.
// Keep server, installation and TLS failures distinct from connectivity errors.
function describeUpdateError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error || '')
  const status = Number(error?.statusCode) || Number(message.match(/(?:HTTP(?:\/\d(?:\.\d)?)?\s+|status(?:\s+code)?[:\s]+)(\d{3})\b/i)?.[1])
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') return {
    kind: 'missing-manifest', message: 'Máy chủ chưa có thông tin cập nhật.',
    detail: 'Không tìm thấy tệp latest.yml trên máy chủ (HTTP 404). Cần bổ sung bộ cập nhật tại máy chủ; kiểm tra lại Internet trên máy này sẽ không sửa được lỗi này.',
  }
  if (status === 404 || code === 'HTTP_ERROR_404') return {
    kind: 'missing-file', message: 'Không tìm thấy tệp cập nhật trên máy chủ.',
    detail: 'Máy chủ trả về HTTP 404. Cần đăng đủ tệp cài đặt và gói cập nhật tương ứng với phiên bản đã công bố.',
  }
  if (['ERR_UPDATER_INVALID_UPDATE_INFO', 'ERR_UPDATER_NO_FILES_PROVIDED', 'ERR_UPDATER_NO_CHECKSUM', 'ERR_UPDATER_CHECKSUM_MISMATCH'].includes(code)) return {
    kind: 'invalid-release', message: 'Bộ cập nhật trên máy chủ chưa hợp lệ.',
    detail: 'Thông tin phiên bản hoặc tệp tải về không khớp. Cần kiểm tra lại bộ phát hành trên máy chủ.',
  }
  if (code === 'ENOENT' && /app-update\.yml/i.test(message)) return {
    kind: 'installation', message: 'Bản ứng dụng này chưa có cấu hình cập nhật.',
    detail: 'Nếu đang dùng bản giải nén ZIP, hãy cài bằng bộ cài TraCuu-Setup để nhận cập nhật tự động.',
  }
  if (/ERR_CERT_|CERT_|CERTIFICATE|UNABLE_TO_VERIFY|SELF_SIGNED|ERR_SSL_|TLS|SSL_ERROR/i.test(`${code} ${message}`)) return {
    kind: 'certificate', message: 'Chưa xác minh được kết nối HTTPS tới máy chủ cập nhật.',
    detail: 'Kiểm tra ngày giờ máy và chứng thư gốc của Windows. Nếu máy dùng proxy tại phòng khám, cần kiểm tra chứng thư của proxy. Không tắt kiểm tra chứng thư để tải bản cập nhật.',
  }
  if (status === 401 || status === 403 || /ERR_PROXY_|ERR_TUNNEL_CONNECTION_FAILED/.test(`${code} ${message}`)) return {
    kind: 'access', message: 'Kết nối tới máy chủ cập nhật đang bị chặn.',
    detail: 'Kiểm tra proxy, tường lửa hoặc quyền truy cập máy chủ. Máy chủ cập nhật cần cho phép tải tệp mà không yêu cầu đăng nhập.',
  }
  if (status >= 500 || status === 429) return {
    kind: 'server', message: 'Máy chủ cập nhật đang tạm thời không sẵn sàng.',
    detail: `Máy chủ trả về HTTP ${status}. Hãy thử lại sau.`,
  }
  if (/ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+|TIMED_OUT|NETWORK_[A-Z_]+)|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(`${code} ${message}`)) return {
    kind: 'network', message: 'Chưa kết nối được tới máy chủ cập nhật.',
    detail: 'Kiểm tra kết nối Internet, DNS, proxy hoặc tường lửa rồi thử lại.',
  }
  if (['ENOSPC', 'EACCES', 'EPERM'].includes(code)) return {
    kind: 'storage', message: 'Chưa lưu được bản cập nhật trên máy.',
    detail: 'Kiểm tra dung lượng trống và quyền ghi vào thư mục của ứng dụng.',
  }
  return {
    kind: 'unknown', message: 'Chưa hoàn tất được việc cập nhật.',
    detail: 'Nguyên nhân chưa xác định. Xem startup.log trong thư mục %APPDATA%\\TraCuu để biết lỗi cụ thể.',
  }
}

module.exports = { describeUpdateError }
