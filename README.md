# Tra cứu — mã nguồn mở

Mã nguồn React/TypeScript và ứng dụng Electron hỗ trợ Windows 7 SP1. Giấy phép MIT áp dụng cho phần mã do dự án phát triển; không cấp quyền đối với dữ liệu hoặc phần mềm bên thứ ba.

## Phạm vi bản công khai

- Có giao diện, mã kết nối CIS chỉ đọc qua UI Automation/MSAA, cơ chế cập nhật và kiểm thử dữ liệu giả.
- Không chứa CIS, file ZIP gốc, dữ liệu bệnh nhân, thông tin đăng nhập, cấu hình Vercel hay bộ cài/binary sinh ra.
- Không phân phối lại Ped(z); chỉ liên kết tới trang tác giả.
- Các bảng thuốc, khoảng tham chiếu, PID và tăng trưởng chưa xác nhận quyền phân phối được để trống có kiểu dữ liệu. Không dùng bản này để tra cứu lâm sàng trước khi tự cung cấp và xác minh dữ liệu có quyền sử dụng. Không tạo số liệu giả để thay thế dữ liệu thiếu.
- Bản chạy thực tế tại máy và bản đã phát hành không bị sửa bởi việc tách bản nguồn này.

## Chạy web

Cần Node.js 24 và pnpm. Trong `duoc-tra-cuu`: `pnpm install --frozen-lockfile`, sau đó `pnpm dev` hoặc `pnpm build`.

## Chạy Electron

Trong `thuoc-pk-windows`: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm start`. Đặt `TRACUU_PASSCODE_SHA256` thành SHA-256 của mã khóa riêng trước khi chạy; bản công khai không chứa mã khóa của bản đang dùng. Đây là khóa cục bộ, không phải cơ chế bảo vệ máy chủ.

`src/main.js` vẫn trỏ đến website đã phát hành. Để dùng bản web riêng, đổi URL đồng bộ với nguồn được phép trong `src/preload.js` và cấu hình feed cập nhật trong `package.json`; không phát hành bộ cài tùy chỉnh lên kênh chính khi chưa đổi định danh/kênh cập nhật của bản fork.

## Biên dịch bộ đọc Windows

DLL không được đưa vào Git. Trên máy phát triển có PowerShell 7, tải assembly tham chiếu chính thức `Microsoft.NETFramework.ReferenceAssemblies.net35` 1.0.3 rồi chạy:

```powershell
./scripts/build-native-helper.ps1 -FrameworkReferences /path/to/build/.NETFramework/v3.5
```

Sau đó chạy `node scripts/verify-native-helper.js` và `pnpm dist:win7:installer`. Bộ đọc tạo ra nhắm CLR 2/AnyCPU; máy Windows chạy ứng dụng không cần trình biên dịch C#. Kiểm tra với CIS thật trên Windows 7 vẫn cần thực hiện ở môi trường được phép.

## Kiểm thử

Desktop: `pnpm test` và `pnpm check`. Web: `pnpm build`. Các bài `smoke-*` chạy bằng Electron và một số bài cần website/kênh cập nhật đã phát hành; không coi đó là kiểm thử độc lập cho mọi bản fork.

## Làm việc online bằng GitHub Codespaces

1. Mở kho trên GitHub → **Code → Codespaces → Create codespace on main**.
2. Chờ môi trường cài Node.js 24 và các phụ thuộc theo lockfile.
3. Chạy `pnpm --dir duoc-tra-cuu dev --host 0.0.0.0 --port 5173` rồi mở cổng **5173** trong mục **Ports** để xem web. Giữ cổng ở chế độ Private khi làm việc.
4. Sửa mã, kiểm tra bằng `pnpm --dir duoc-tra-cuu build` và `pnpm --dir thuoc-pk-windows test`, sau đó commit/push về GitHub.

GitHub Actions tự build web và kiểm tra mã desktop sau mỗi push/pull request. Codespaces dùng Linux: có thể sửa mã và chạy kiểm thử Node, nhưng không đọc CIS thật hoặc kiểm chứng cài đặt Windows 7 trong môi trường này. Bản nguồn công khai không kèm các bảng dữ liệu lâm sàng; dữ liệu riêng và thông tin cấu hình phải được cấp riêng, không commit vào kho.

## Cửa sổ popup (1.4.7)

Cửa sổ chính không có thanh tiêu đề Windows; kéo phần trống trên thanh Tra cứu để di chuyển và kéo mép để đổi kích thước. Thu nhỏ/phóng to/khôi phục/đóng popup nằm trong các nút xem trước trên taskbar Windows. Menu chuột phải taskbar có các lệnh tương ứng và Thoát hoàn toàn; nếu Windows không hiển thị hình xem trước, dùng menu này. Đóng popup vẫn khóa và thu xuống khay hệ thống; Ctrl+Alt+T mở lại. Thanh điều khiển của cửa sổ thiết lập riêng được giữ để dễ đóng. Trên Mac, dùng menu ứng dụng hoặc Cmd+Q để thoát bản xem thử.

Đã kiểm tra 31 bài Node và preload/React ở chế độ frameless trên macOS; chưa chạy thao tác taskbar trên Windows 7 thật.
