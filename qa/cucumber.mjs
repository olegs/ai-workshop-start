// The QA scenarios of spec/qa.md: `npm run qa`. The features in qa/features, the steps in qa/steps,
// the browser, the mock server and the screenshots in qa/support.
export default {
  paths: ['qa/features/**/*.feature'],
  import: ['qa/support/**/*.ts', 'qa/steps/**/*.ts'],
  format: ['progress'],
  strict: true,
};
