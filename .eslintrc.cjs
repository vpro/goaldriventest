module.exports = {
  root: true,
  extends: ["prettier"],
  rules: {
    "import/no-default-export": "off",
  },
  parserOptions: {
    ecmaVersion: 2024,
	  sourceType: "module"
  },
  env: {
    node: true,
    es6: true
  },
  ignorePatterns: ["node_modules/", "**/node_modules/", "dist/"],
};

