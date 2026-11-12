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
- Chọn **Khám phá**, bấm đường, chỉnh bề rộng, mức ưu tiên, biển nhường/dừng và cách phân lượt tại hai đầu đoạn đường rồi áp dụng. Chọn dừng mọi hướng sẽ áp dụng cho các nhánh của giao lộ; nhập dòng luân phiên dùng thứ tự nhánh đã vào trước.
- Đặt nhà cạnh đường, cách mép ít nhất 4 m. Xe ra/vào cửa nhà qua lối nối.
- Đặt vòng xoay trên giao lộ để chuyển các nhánh đường sang vòng một chiều. Đặt đèn tại giao lộ có ít nhất ba nhánh.
- Kéo trái: di chuyển camera (Khám phá). Kéo phải: xoay. Cuộn: zoom. Nút bản đồ: góc nhìn trên cao/đặt lại.
- Trong tab **Giao thông**, bật **Hiện hướng tất cả xe** để xem 30 m lộ trình phía trước bằng vệt màu và mũi tên: vàng cho xe máy, xanh dương cho xe con, tím cho xe tải. Vệt đi theo đường cong/cầu và dịch ngang dự kiến; xe có thể đổi hướng tránh nhau. Có thể xem khi tạm dừng.
- Trong chế độ **Khám phá** (phím **1**) hoặc tab **Giao thông**, bấm trực tiếp vào một xe để xem riêng hướng đi. Xe được đánh dấu bằng vòng vàng, kèm tốc độ, quãng đường còn lại, trạng thái và lý do chờ/lùi. Bấm xe khác để đổi; bấm chỗ trống, nút **×** hoặc **Esc** để bỏ chọn. Chọn xe tự tắt hiển thị hướng toàn bộ; bật lại **Hiện hướng tất cả xe** để xem cả thành phố.
- Trong tab **Giao thông**, chọn pha đèn hai hướng hoặc các pha đi thẳng/rẽ riêng. Đèn có vàng và khoảng đỏ toàn bộ; đổi cấu hình bắt đầu lại lượt xe.
- **Space**: tạm dừng. **Esc**: hủy. **Ctrl/Cmd+Z**: hoàn tác.
- Lưu/mở bản đồ bằng localStorage của trình duyệt. Thay đổi mạng đường sẽ xóa lượt xe hiện tại và tạo hành trình mới.

## Mô phỏng

Ba loại xe có kích thước, chiều dài cơ sở, góc lái tối đa, tăng tốc, phanh, khoảng cách bám và tốc độ vào cua riêng. Tài xế có mức tốc độ mong muốn ổn định trong từng chuyến. Tuyến đi dùng đồ thị có hướng, chi phí hàng đợi, các cung chuyển tiếp và lối ra/vào nhà. Khi chờ tắc lâu trên đoạn thẳng, xe chỉ đổi tuyến nếu tuyến mới có chi phí tốt hơn; vị trí và hướng thân xe được giữ liên tục.

Xe giới hạn tốc độ theo khoảng dừng trong tầm quan sát. Dự đoán xung đột dùng cùng mô hình lái với chuyển động thật; quyền ưu tiên không bỏ qua phanh an toàn. Xe nhường khi gặp luồng đang chạy, và chỉ tìm cung tránh khi có vật cản đứng yên trên đường đi. Cung tránh phải đủ chỗ để phanh dừng sau đoạn đi vòng. Xe được nhường chờ trong lúc xe kia lùi; xe lùi xong tiếp tục chừa đường cho đến khi xe cần đi qua đã thoát. Khi có chồng lấn sau sự cố, chế độ phục hồi chỉ cho phép chuyển động giảm chồng lấn, đồng thời vẫn kiểm tra các xe khác.

Đổi tuyến được đánh giá định kỳ ở các thời điểm phân tán theo xe, với chi phí giây chạy và giây chờ hàng xe được làm mượt. Tuyến mới phải tiết kiệm ít nhất 3 giây và 15% chi phí dự kiến, có khoảng chờ giữa các lần đổi. Bộ tìm đường dùng hàng đợi ưu tiên. Quan sát dùng lưới không gian và chia sẻ điểm thân xe trong mỗi bước; dự đoán lọc nhanh bằng vùng bao trước khi kiểm tra thân xe chính xác. Vòng hiển thị dành khoảng 8 ms cho các bước mô phỏng mỗi khung hình và chặn tích lũy bước trễ; một bước riêng lẻ vẫn có thể vượt ngân sách này.

Đo mô phỏng không có render bằng `npm run benchmark:driving -- 1 25 360` (seed, số xe mục tiêu, số giây). Sau 120 giây mô phỏng ngừng sinh xe để đo khả năng thoát hàng chờ. Kết quả ghi vào `test-results/driving-benchmark.json`, gồm số chuyến hoàn tất, xe còn lại, số lần thân xe chồng lấn và thời gian xử lý bước median/p95/p99. Các số này đo CPU mô phỏng, không phải FPS trình duyệt.

Các trạng thái phân biệt chạy, bám xe, chờ đèn, nhường đường, dừng bắt buộc, chờ phía ra thông thoáng, nhập dòng, bị chặn, lùi và chờ trong nhà. Thời gian chờ đèn hoặc bám hàng xe không tự kích hoạt lùi. Giao lộ xác định từ mạng đường, có thông tin nhánh vào/ra, quyền ưu tiên và vùng xung đột. Xe trong vòng xoay, xe đã vào giao lộ, đường chính, biển nhường/dừng, thứ tự đến và nhập dòng luân phiên được xử lý riêng. Chỉ xe gần phía trước, thực sự chắn hoặc sắp cắt hướng đi trong thời gian ngắn, mới làm xe nhường. Xe xa, ở phía sau hoặc đã đi qua không giữ xe lại; khi lối phía trước trống xe tiếp tục ngay. Hai quỹ đạo không xung đột có thể cùng đi.

Với hai quỹ đạo cắt nhau, xe tính khoảng thời gian từ lúc đầu xe vào đến khi đuôi xe ra hết vùng xung đột, có xét chiều dài xe tải và hình dạng tuyến. Nếu một xe ra hết trước lúc xe kia có thể tới sớm nhất, kèm đệm 0,6 giây, hai xe có thể tiếp tục. Thời điểm tới sớm nhất có xét giới hạn tăng tốc; thời điểm thoát dùng tốc độ đo được, nên không dựa vào giả định đối phương chắc chắn tăng tốc. Khi thời gian chiếm chỗ chồng nhau và các quy tắc ưu tiên chưa phân định, xe tới trước theo tốc độ thực tế được đi trước; nếu tới gần đồng thời thì xét khả năng thoát cả thân xe. Xe đứng yên có thể nhận lượt dựa trên khả năng khởi hành, nhưng chưa được coi là đã có khoảng thoát an toàn theo tốc độ thực tế. Lượt được giữ khi xe còn tiến, tối đa 6 giây; sau 1,2 giây không tiến hoặc khi lối ra bị chặn thì xét lại. Xe nhường bắt đầu giảm tốc ngay và dừng trước vùng thân xe có thể giao nhau. Kiểm tra va chạm vẫn có thể bắt xe được đi trước phải phanh.

Xe bám sau một xe đang kẹt, nhường, lùi hoặc chờ phía ra giữ khoảng trống mục tiêu 2,5 m khi xe trước đứng yên; vật cản đứng yên trên cung đi có khoảng đệm dừng 1,5 m. Đây là khoảng trống mục tiêu, không dịch chuyển xe để tạo khoảng cách nếu xe đã ở quá gần. Dự đoán nhường kiểm tra các vị trí dừng với tất cả xe quan sát được. Đường vòng được kiểm tra trong 3–6 giây tùy khoảng cách và chiều dài vật cản, cộng đoạn phanh cuối; khoảng trống sau xe không mặc nhiên được dùng để lùi vào hàng chờ.

Bám xe dùng khoảng cách thời gian và chênh lệch tốc độ; xe giảm tốc trước cua theo độ cong. Ô tô và xe tải chọn vị trí trong các làn suy ra từ bề rộng; xe máy dùng các dải nhỏ hơn. Đổi vị trí kiểm tra hành lang phía trước và khoảng trống với xe sau. Khi phía ra không đủ chỗ cho thân xe, xe chờ ngoài giao lộ. Đèn đỏ là giới hạn hình học cho cả đầu và góc thân xe; đèn vàng xét khả năng dừng, và có thể cấu hình các pha rẽ riêng.

Chuyển động dùng cung lái theo mô hình động học xe đạp, kể cả khi lùi. Không dịch ngang hoặc xoay thân tại chỗ; bánh trước vẫn có thể đánh lái khi đứng yên. Bước tích phân không quá 1/60 giây, nên lời gọi mô phỏng ở 30 Hz cũng chạy hai bước vật lý. Va chạm dùng SAT liên tục trên cung di chuyển và sự xoay của toàn thân xe, bao gồm góc đuôi xe tải; không chỉ kiểm tra hai vị trí đầu/cuối. Mặt đường và lối vào nhà được lập chỉ mục không gian.

Bộ gỡ kẹt tìm vòng chờ giữa các xe, thử cung tiến trước, rồi chọn một xe lùi khi thật sự cần mở đường. Toàn hành lang lùi được kiểm tra với xe đứng yên và xe đang tới phía sau. Nếu dùng một phần khoảng trống với xe đứng yên cùng hướng phía sau, cung lùi phải được dự trữ và vẫn giữ tối thiểu 0,9 m giữa các thân xe. Một lượt lùi giao thông dài tối đa 4 m, có thời hạn và kiểm tra lại từng bước; xe đang lùi nhường quyền cho xe cần đi qua. Xe chưa ra hết cửa có thể lùi vào garage chờ xe về. Xi nhan, đèn phanh, đèn lùi, góc bánh trước và độ nghiêng xe máy phản ánh trạng thái mô phỏng.

Mô hình vẫn dùng thân xe hình hộp và động học đơn giản, chưa mô phỏng lốp, va đập hoặc toàn bộ luật của một quốc gia. Mạng đường quá hẹp hoặc quá tải có thể cần người chơi mở rộng/kết nối thêm đường; xe giữ vị trí khi không có chuyển động an toàn.

## Cấu trúc

- `src/simulation.ts`: hình học, mạng đường, tìm đường, dữ liệu giao lộ và pha đèn.
- `src/driving.ts`: bám xe, chọn làn, nhường đường, gỡ kẹt và đổi tuyến.
- `src/crossing-time.ts`: vùng giao nhau của toàn thân xe và so sánh thời gian tới/thoát.
- `src/kinematics.ts`: tích phân cung lái tiến/lùi.
- `src/collision.ts`: kiểm tra va chạm liên tục theo thân xe.
- `src/scene.ts`: thành phố và phương tiện Three.js, camera, ánh sáng.
- `src/main.ts`: công cụ xây dựng, giao diện, lưu bản đồ, vòng lặp.
- `tests/simulation.test.ts`: kết nối, khoảng hở và lưu thông hỗn hợp theo nhiều seed/phía đi/tần số gọi.
- `tests/driving.test.ts`: quyền ưu tiên, hàng chờ, pha đèn, cung lái, lùi và đổi tuyến.
- `tests/collision.test.ts`: va chạm giữa hai mẫu, góc xe đang xoay và chuyển động rất nhỏ.
- `tests/browser-smoke.mjs`: WebGL, tín hiệu, bảng trạng thái, các thiết lập giao thông, lưu/hoàn tác và mobile.

Không cần API key hay backend. Cần trình duyệt hỗ trợ WebGL2. Font web có font hệ thống dự phòng khi không có mạng.

Tua thời gian: thanh phía trên nút chạy lưu tối đa 5 phút mô phỏng gần nhất,
ở các mốc cách nhau 0,5 giây. Kéo thanh hoặc bấm “↶ 5s” để tạm dừng
và xem lại; “Mới nhất” trở về mốc cuối đã lưu. Bấm ▶ hoặc Space để chạy
tiếp từ thời điểm đang xem, thay thế phần lịch sử phía sau. Thay đổi đường sá
bắt đầu lại lịch sử; lịch sử chỉ tồn tại trong phiên đang mở. Khi không thay đổi thiết lập giao thông, chạy tiếp sau khi tua lại tái hiện
đúng chuỗi sinh xe và quyết định di chuyển trước đó.
