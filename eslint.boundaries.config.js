// Bất biến I1 (docs/WORK-BREAKDOWN.md mục 4.2): src/face/** và src/classify/** không được import
// module có quyền đọc frame gốc. Cho phép: src/core/** (kiểu và toán thuần), thư viện model, file cùng thư mục.
// CLS-01 (I8): src/dataset/** cũng vậy: chỉ nhận crop qua CropTap của restrictedFrame, không với tới camera hay canvas.
// LOG-02: src/log/** chỉ nhận sự kiện metadata do app xây; cấm mọi đường tới frame, canvas, landmark như trên.
// Chạy riêng: npm run lint:boundaries. Cũng được gộp vào eslint.config.js.
import tseslint from 'typescript-eslint'

const forbidden = ['camera', 'hands', 'reveal', 'mask', 'app', 'loop', 'debug']

export default [
  {
    files: ['src/face/**/*.ts', 'src/classify/**/*.ts', 'src/dataset/**/*.ts', 'src/log/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidden.map((dir) => ({
            group: [`**/${dir}/**`, `**/${dir}`],
            message: `I1, I8, LOG-02: face/, classify/, dataset/ và log/ không được import ${dir}/. Chỉ core/**, thư viện model và file cùng thư mục.`,
          })),
        },
      ],
    },
  },
]
