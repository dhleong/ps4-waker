module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "airbnb-base",
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaVersion": 2018
    },
    "plugins": [
        "@typescript-eslint",
    ],
    "rules": {
        "class-methods-use-this": "off",
        "consistent-return": "off",
        "arrow-body-style": "off",
        "func-names": "off", // for now
        "indent": ["error", 4],
        "newline-per-chained-call": ["error", {
            "ignoreChainWithDepth": 6,
        }],
        "no-bitwise": ["error", {
            "allow": ["<<"],
        }],
        "no-continue": "off",
        "no-param-reassign": "off",
        "no-restricted-syntax": [
            'error',
            {
                selector: 'LabeledStatement',
                message: 'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
            },
        ],
        "no-underscore-dangle": ["error", {
            "allowAfterThis": true,
        }],
        "padded-blocks": ["error", {
            // classes are okay
            "blocks": "never",
            "switches": "never",
        }],
        "space-before-function-paren": ["error", {
            "anonymous": "never",
            "asyncArrow": "always",
            "named": "never",
        }],
        "@typescript-eslint/explicit-module-boundary-types": "off",
    },
};
