# Fixture camera giả (TEST-00)

`camera.y4m` được tạo bằng `tools/make_test_clips.py` và không commit (`*.y4m` trong .gitignore). Khi file tồn tại, `playwright.config.ts` tự thêm `--use-file-for-fake-video-capture`; khi chưa có, Chromium dùng nguồn giả mặc định.
