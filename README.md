# Phố Flow

Web game sandbox giao thông 3D, viết bằng TypeScript, Three.js và Vite.

## Chạy trên máy

```sh
npm install
npm run dev
```

Mở địa chỉ Vite in trong terminal (thường là http://127.0.0.1:5173).

```sh
npm run build
npm test
```

## Điều khiển

- **1–8**: khám phá, đường thẳng, đường cong, cầu, vòng xoay, nhà, đèn, tháo dỡ.
- Đường thẳng/cầu: bấm điểm đầu và điểm cuối. Đường cong: điểm đầu → điểm cuối → điểm điều khiển.
- Giao nhau cùng cao độ tự nối thành mạng đường. Các giao cắt khác cao độ không nối.
- Bề rộng từ **3–10 mét mỗi chiều**. Với vòng xoay, đây là toàn bộ chiều rộng đường một chiều.
- Chọn **Khám phá**, bấm đường, chỉnh thanh trượt rồi áp dụng để đổi bề rộng đường đã xây.
- Đặt nhà cạnh đường, cách mép ít nhất 4 m. Xe ra/vào cửa nhà qua lối nối.
- Đặt vòng xoay trên giao lộ để chuyển các nhánh đường sang vòng một chiều. Đặt đèn tại giao lộ có ít nhất ba nhánh.
- Kéo trái: di chuyển camera (Khám phá). Kéo phải: xoay. Cuộn: zoom. Nút bản đồ: góc nhìn trên cao/đặt lại.
- Trong tab **Giao thông**, bật **Hiện hướng tất cả xe** để xem 30 m lộ trình phía trước bằng vệt màu và mũi tên: vàng cho xe máy, xanh dương cho xe con, tím cho xe tải. Vệt đi theo đường cong/cầu và dịch ngang dự kiến; xe có thể đổi hướng tránh nhau. Có thể xem khi tạm dừng.
- Trong chế độ **Khám phá** (phím **1**) hoặc tab **Giao thông**, bấm trực tiếp vào một xe để xem riêng hướng đi. Xe được đánh dấu bằng vòng vàng, kèm tốc độ và quãng đường còn lại. Bấm xe khác để đổi; bấm chỗ trống, nút **×** hoặc **Esc** để bỏ chọn. Chọn xe tự tắt hiển thị hướng toàn bộ; bật lại **Hiện hướng tất cả xe** để xem cả thành phố.
- **Space**: tạm dừng. **Esc**: hủy. **Ctrl/Cmd+Z**: hoàn tác.
- Lưu/mở bản đồ bằng localStorage của trình duyệt. Thay đổi mạng đường sẽ xóa lượt xe hiện tại và tạo hành trình mới.

## Mô phỏng

Ba loại xe có hình chữ nhật định hướng với chiều rộng/chiều dài riêng: xe máy 0,8 × 2 m, xe con 1,8 × 3,9 m, xe tải 2,3 × 6,4 m. Mỗi xe chọn một nhà đích, tìm đường qua đồ thị có hướng và chạy theo đường dẫn được làm mượt. Bộ tìm đường loại bỏ quay đầu ngay tại nút nối và ưu tiên đi trực tiếp khi hai nhà cùng đoạn đường. Các đoạn tại giao lộ được nối bằng cung chuyển tiếp theo tiếp tuyến; điểm trùng từ bản đồ cũ được loại bỏ khi tải. Xe có thể dịch ngang liên tục trong phạm vi đường, không bị ép vào một hàng xe cố định.

Mô phỏng chạy bước cố định 1/60 giây. Bộ lọc không gian tìm xe lân cận; kiểm tra SAT giữa các hình chữ nhật chặn chuyển động gây giao nhau. Chuyển động được kiểm tra theo bước tối đa 10 cm. Xe giảm tốc theo khoảng trống, thử vị trí ngang khác và có thể lùi chậm để nhường xe khi bị chặn. Hướng thân xe lấy theo tiếp tuyến làm mượt. Xe nhường theo giao nhau dự kiến giữa thân hai xe trong thời gian ngắn; không khóa cả giao lộ hoặc vòng xoay cho một xe. Cơ chế lùi chỉ kích hoạt khi có xe thực sự chắn hướng tiến và kiểm tra khoảng trống phía sau trước mỗi bước. Đèn có chu kỳ 24 giây và khoảng nghỉ toàn bộ giữa hai hướng.

Đây là mô phỏng sandbox, không phải bộ mô phỏng giao thông dùng cho thiết kế hạ tầng. Không thể bảo đảm mọi mạng đường do người chơi tạo đều tự hết tắc: đường quá hẹp, vòng kín hoặc giao lộ quá tải có thể cần người chơi mở rộng/kết nối thêm đường. Ưu tiên dừng an toàn khi không tìm được chuyển động hợp lệ.

## Cấu trúc

- `src/simulation.ts`: hình học, mạng đường, tìm đường, xe, tránh va chạm.
- `src/scene.ts`: thành phố và phương tiện Three.js, camera, ánh sáng.
- `src/main.ts`: công cụ xây dựng, giao diện, lưu bản đồ, vòng lặp.
- `tests/simulation.test.ts`: kiểm tra kết nối, khoảng hở, nhiều xe song song và lưu thông hỗn hợp.

Không cần API key hay backend. Cần trình duyệt hỗ trợ WebGL2. Font web có font hệ thống dự phòng khi không có mạng.
