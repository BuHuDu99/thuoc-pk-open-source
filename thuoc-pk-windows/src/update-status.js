function describeNoUpdate(installed, published) {
  if (published && installed !== published) return {
    message: `Phiên bản đang dùng: ${installed}. Máy chủ hiện công bố: ${published}.`,
    detail: 'Chưa có bản nâng cấp phù hợp trên kênh cập nhật này. Ứng dụng không tự hạ xuống phiên bản thấp hơn.',
  }
  return { message: `Bạn đang dùng phiên bản mới nhất (${installed}).`, detail: '' }
}
module.exports = { describeNoUpdate }
