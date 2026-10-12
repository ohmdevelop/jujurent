module.exports = {
  content: ['./views/**/*.ejs', './public/app.js', './src/**/*.js'],
  theme: {
    extend: {
      colors: { p: 'var(--p)', ink: '#0f1923', card: '#16222e', line: '#253545' },
      fontFamily: { sans: ['Kanit', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
