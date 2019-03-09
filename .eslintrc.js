module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "extends": ["eslint:recommended", "airbnb-base"],
    "parserOptions": {
        "ecmaVersion": 2018
    },
    "rules": {
        "class-methods-use-this": "off",
        "arrow-body-style": "off",
        "func-names": "off", // for now
        "indent": ["error", 4],
        "newline-per-chained-call": ["error", {
            "ignoreChainWithDepth": 6,
        }],
        "no-bitwise": ["error", {
            "allow": ["<<"],
        }],
        "no-param-reassign": "off",
        "no-restricted-syntax": [
            'error',
            {
                selector: 'ForInStatement',
                message: 'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
            },
            {
                selector: 'LabeledStatement',
                message: 'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
            },
            {
                selector: 'WithStatement',
                message: '`with` is disallowed in strict mode because it makes code impossible to predict and optimize.',
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
    },
};
