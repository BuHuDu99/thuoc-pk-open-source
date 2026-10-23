const form = document.getElementById('lock-form')
const input = document.getElementById('passcode')
const message = document.getElementById('message')
const submitButton = document.getElementById('unlock-button')

let countdownTimer = null

function showCountdown(seconds) {
  let remaining = seconds
  input.disabled = true
  submitButton.disabled = true
  message.className = 'message error'
  message.textContent = `Đã nhập sai nhiều lần. Thử lại sau ${remaining} giây.`

  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    remaining -= 1
    if (remaining <= 0) {
      clearInterval(countdownTimer)
      input.disabled = false
      submitButton.disabled = false
      submitButton.textContent = 'Mở ứng dụng'
      message.textContent = 'Có thể nhập lại mã khóa.'
      message.className = 'message'
      input.focus()
      return
    }
    message.textContent = `Đã nhập sai nhiều lần. Thử lại sau ${remaining} giây.`
  }, 1000)
}

input.addEventListener('input', () => {
  input.value = input.value.replace(/\D/g, '').slice(0, 8)
  message.textContent = ''
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!input.value) {
    message.className = 'message error'
    message.textContent = 'Vui lòng nhập mã khóa.'
    input.focus()
    return
  }

  submitButton.disabled = true
  submitButton.textContent = 'Đang kiểm tra...'
  try {
    const result = await window.appLock.unlock(input.value)
    if (result.ok) {
      message.className = 'message success'
      message.textContent = 'Đúng mã. Đang mở Tra cứu...'
      return
    }
    input.value = ''
    if (result.waitSeconds) {
      showCountdown(result.waitSeconds)
    } else {
      message.className = 'message error'
      message.textContent = `Mã khóa không đúng.${Number.isFinite(result.remainingAttempts) ? ` Còn ${result.remainingAttempts} lần thử.` : ''}`
      submitButton.disabled = false
      input.focus()
    }
  } catch (_) {
    message.className = 'message error'
    message.textContent = 'Không thể kiểm tra mã khóa. Hãy khởi động lại ứng dụng.'
    submitButton.disabled = false
  } finally {
    if (!submitButton.disabled) submitButton.textContent = 'Mở ứng dụng'
  }
})

input.value = ''
input.focus()
