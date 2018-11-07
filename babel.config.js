const presets = [
  [
    "@babel/env",
    {
      targets: {
        node: "6",
      },
      useBuiltIns: "usage",
    },
  ],
];

module.exports = {presets};
