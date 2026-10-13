# Command reference

Generated from `agent-cli schema <command>`. Do not edit by hand.

Global flags: `--config PATH`, `--network mainnet|testnet`, `--pretty`, `--json OBJECT`.

## config

Get, set or validate local configuration

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "args": {
        "default": [],
        "type": "array",
        "items": {
          "type": "string"
        }
      }
    },
    "required": [
      "args"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## init

Create agent and emit resumable master-wallet approvals

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "masterAddress": {
        "type": "string",
        "pattern": "^0x[0-9a-fA-F]{40}$"
      },
      "validUntil": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
      },
      "signature": {
        "type": "string"
      },
      "builderSignature": {
        "type": "string"
      },
      "qr": {
        "default": true,
        "type": "boolean"
      }
    },
    "required": [
      "qr"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## fund

Quote funding with address, QR and transparent fees

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "originChain": {
        "default": 42161,
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "originCurrency": {
        "default": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        "type": "string"
      },
      "originDecimals": {
        "default": 6,
        "type": "integer",
        "minimum": 0,
        "maximum": 30
      },
      "amount": {
        "default": "10",
        "type": "string"
      },
      "qr": {
        "default": true,
        "type": "boolean"
      },
      "qrPath": {
        "type": "string"
      }
    },
    "required": [
      "originChain",
      "originCurrency",
      "originDecimals",
      "amount",
      "qr"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## deposit

Resume deposit steps or submit a master-wallet signature

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "depositId": {
        "type": "string"
      },
      "stepId": {
        "type": "string"
      },
      "signature": {
        "type": "string"
      }
    },
    "required": [
      "depositId"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## status

Read account status

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## balance

Read account balance

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## positions

Read account positions

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## orders

Read account orders

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## order

Place limit, IOC market or TP/SL order

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "coin": {
        "type": "string"
      },
      "side": {
        "type": "string",
        "enum": [
          "buy",
          "sell"
        ]
      },
      "size": {
        "type": "string"
      },
      "price": {
        "type": "string"
      },
      "type": {
        "default": "limit",
        "type": "string",
        "enum": [
          "limit",
          "market",
          "tp",
          "sl"
        ]
      },
      "tif": {
        "default": "Gtc",
        "type": "string",
        "enum": [
          "Gtc",
          "Ioc",
          "Alo"
        ]
      },
      "reduceOnly": {
        "default": false,
        "type": "boolean"
      },
      "cloid": {
        "type": "string",
        "pattern": "^0x[0-9a-fA-F]{32}$"
      },
      "triggerPrice": {
        "type": "string"
      },
      "slippage": {
        "default": 0.01,
        "type": "number",
        "minimum": 0,
        "maximum": 0.1
      },
      "intent": {
        "type": "string"
      },
      "intentId": {
        "type": "string"
      }
    },
    "required": [
      "coin",
      "side",
      "size",
      "type",
      "tif",
      "reduceOnly",
      "slippage"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## cancel

Cancel by oid/cloid, coin or all

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "oid": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "oids": {
        "type": "array",
        "items": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      },
      "cloid": {
        "type": "string"
      },
      "cloids": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "coin": {
        "type": "string"
      },
      "all": {
        "default": false,
        "type": "boolean"
      },
      "intent": {
        "type": "string"
      },
      "intentId": {
        "type": "string"
      }
    },
    "required": [
      "all"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## modify

Modify price/size of single or batch resting orders

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "oid": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "cloid": {
        "type": "string",
        "pattern": "^0x[0-9a-fA-F]{32}$"
      },
      "size": {
        "type": "string"
      },
      "price": {
        "type": "string"
      },
      "modifications": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "oid": {
              "type": "integer",
              "exclusiveMinimum": 0,
              "maximum": 9007199254740991
            },
            "cloid": {
              "type": "string",
              "pattern": "^0x[0-9a-fA-F]{32}$"
            },
            "size": {
              "type": "string"
            },
            "price": {
              "type": "string"
            }
          },
          "additionalProperties": false
        }
      },
      "intent": {
        "type": "string"
      },
      "intentId": {
        "type": "string"
      }
    },
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## leverage

Set market leverage and cross/isolated margin mode

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "coin": {
        "type": "string"
      },
      "leverage": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "mode": {
        "default": "cross",
        "type": "string",
        "enum": [
          "cross",
          "isolated"
        ]
      },
      "intent": {
        "type": "string"
      },
      "intentId": {
        "type": "string"
      }
    },
    "required": [
      "coin",
      "leverage",
      "mode"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## run

Start persistent signing runner (foreground or detach)

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "detach": {
        "default": false,
        "type": "boolean"
      },
      "daemon": {
        "default": false,
        "type": "boolean"
      }
    },
    "required": [
      "detach",
      "daemon"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## events

Replay or follow JSON-line runner events

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "follow": {
        "default": false,
        "type": "boolean"
      },
      "since": {
        "default": 0,
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      },
      "types": {
        "default": [],
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "fill",
            "order_update",
            "position_change",
            "deposit",
            "error",
            "agent_expiry_warning",
            "runner_state"
          ]
        }
      }
    },
    "required": [
      "follow",
      "since",
      "types"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## logs

Read/follow redacted JSON-line runner logs

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "follow": {
        "default": false,
        "type": "boolean"
      },
      "level": {
        "type": "string",
        "enum": [
          "debug",
          "info",
          "warn",
          "error"
        ]
      },
      "since": {
        "type": "string",
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
      },
      "requestId": {
        "type": "string"
      }
    },
    "required": [
      "follow"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## rotate

Approve new agent, hot-swap signer, then revoke old agent

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "signature": {
        "type": "string"
      },
      "revokeSignature": {
        "type": "string"
      },
      "intentId": {
        "type": "string"
      },
      "intent": {
        "type": "string"
      }
    },
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## revoke

Disable local agent and prepare master-signed exchange revocation

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "cancelOrders": {
        "default": false,
        "type": "boolean"
      },
      "signature": {
        "type": "string"
      },
      "intentId": {
        "type": "string"
      },
      "intent": {
        "type": "string"
      }
    },
    "required": [
      "cancelOrders"
    ],
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

## audit

Verify and query the hash-chained trading audit

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "intent": {
        "type": "string"
      },
      "intentId": {
        "type": "string"
      },
      "cloid": {
        "type": "string"
      }
    },
    "additionalProperties": false
  },
  "output": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "ok",
          "data"
        ],
        "properties": {
          "ok": {
            "const": true
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "required": [
          "ok",
          "code",
          "message",
          "retryable",
          "details"
        ],
        "properties": {
          "ok": {
            "const": false
          },
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          },
          "details": {}
        }
      }
    ]
  }
}
```

