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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "masterAddress": {
                "type": "string"
              },
              "agentAddress": {
                "type": "string"
              },
              "expiry": {
                "type": "number"
              },
              "policyId": {
                "type": "string"
              },
              "approved": {
                "type": "boolean"
              },
              "requiresSignature": {
                "type": "boolean"
              },
              "approvals": {},
              "deeplink": {
                "type": "string"
              },
              "qrAscii": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "masterAddress",
              "agentAddress",
              "expiry",
              "policyId",
              "approved"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "depositId": {
                "type": "string"
              },
              "depositAddress": {
                "type": "string"
              },
              "originChain": {
                "type": "number"
              },
              "originCurrency": {
                "type": "string"
              },
              "minDeposit": {
                "type": "string"
              },
              "expectedReceived": {
                "type": "string"
              },
              "expectedReceivedHuman": {
                "type": "string"
              },
              "fees": {},
              "builderFeeRate": {
                "type": "string"
              },
              "expiresAt": {
                "type": "number"
              },
              "state": {
                "type": "string"
              },
              "signatureSteps": {
                "type": "array",
                "items": {}
              },
              "qrAscii": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "qrPath": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "depositId",
              "depositAddress",
              "expectedReceived",
              "fees",
              "builderFeeRate",
              "expiresAt",
              "qrAscii"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "depositId": {
                "type": "string"
              },
              "steps": {
                "type": "array",
                "items": {}
              },
              "complete": {
                "type": "boolean"
              }
            },
            "required": []
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "balance": {
                "type": "object",
                "properties": {
                  "accountValue": {
                    "type": "string"
                  },
                  "accountValueUnits": {
                    "type": "string"
                  },
                  "withdrawable": {
                    "type": "string"
                  },
                  "marginUsed": {
                    "type": "string"
                  }
                },
                "required": [
                  "accountValue",
                  "accountValueUnits",
                  "withdrawable",
                  "marginUsed"
                ]
              },
              "positions": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "coin": {
                      "type": "string"
                    },
                    "size": {
                      "type": "string"
                    },
                    "entryPrice": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "unrealizedPnl": {
                      "type": "string"
                    },
                    "liquidationPrice": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "leverage": {
                      "type": "string"
                    },
                    "marginMode": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "coin",
                    "size",
                    "leverage"
                  ]
                }
              },
              "agent": {
                "type": "object",
                "properties": {
                  "address": {
                    "type": "string"
                  },
                  "approved": {
                    "type": "boolean"
                  },
                  "revoked": {
                    "type": "boolean"
                  },
                  "expiry": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "daysRemaining": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "warnings": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "required": []
              },
              "policy": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "version": {
                    "type": "string"
                  }
                },
                "required": []
              },
              "deposits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "state": {
                      "enum": [
                        "awaiting_funds",
                        "pending",
                        "settled",
                        "failed",
                        "refunded"
                      ]
                    }
                  },
                  "required": []
                }
              },
              "approvedMaxBuilderFee": {
                "type": "string"
              },
              "runner": {
                "type": [
                  "object",
                  "null"
                ]
              }
            },
            "required": [
              "balance",
              "positions",
              "agent",
              "policy",
              "deposits",
              "approvedMaxBuilderFee",
              "runner"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "accountValue": {
                "type": "string"
              },
              "accountValueUnits": {
                "type": "string"
              },
              "withdrawable": {
                "type": "string"
              },
              "marginUsed": {
                "type": "string"
              }
            },
            "required": [
              "accountValue",
              "accountValueUnits",
              "withdrawable",
              "marginUsed"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "coin": {
                  "type": "string"
                },
                "size": {
                  "type": "string"
                },
                "entryPrice": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "unrealizedPnl": {
                  "type": "string"
                },
                "liquidationPrice": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "leverage": {
                  "type": "string"
                },
                "marginMode": {
                  "type": "string"
                }
              },
              "required": [
                "coin",
                "size",
                "leverage"
              ]
            }
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "coin": {
                  "type": "string"
                },
                "oid": {
                  "type": "string"
                },
                "sz": {
                  "type": "string"
                },
                "limitPx": {
                  "type": "string"
                },
                "side": {
                  "enum": [
                    "A",
                    "B"
                  ]
                },
                "cloid": {
                  "type": "string"
                }
              },
              "required": [
                "coin",
                "oid",
                "sz",
                "limitPx",
                "side"
              ]
            }
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "result": {},
              "builderFeeRate": {
                "type": "string"
              },
              "cloid": {
                "type": [
                  "string",
                  "null"
                ]
              }
            },
            "required": [
              "result",
              "builderFeeRate",
              "cloid"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "cancelled": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "result": {}
            },
            "required": [
              "cancelled",
              "result"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "status": {
                "type": "string"
              },
              "response": {}
            },
            "required": [
              "status"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "status": {
                "type": "string"
              },
              "response": {}
            },
            "required": [
              "status"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "pid": {
                "type": "integer"
              },
              "startedAt": {
                "type": "number"
              },
              "network": {
                "enum": [
                  "mainnet",
                  "testnet"
                ]
              },
              "ready": {
                "type": "boolean"
              },
              "existing": {
                "type": "boolean"
              }
            },
            "required": [
              "pid",
              "startedAt",
              "network"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "seq": {
                  "type": "integer",
                  "minimum": 1
                },
                "timestamp": {
                  "type": "string",
                  "format": "date-time"
                },
                "type": {
                  "enum": [
                    "fill",
                    "order_update",
                    "position_change",
                    "deposit",
                    "error",
                    "agent_expiry_warning",
                    "runner_state"
                  ]
                },
                "data": {}
              },
              "required": [
                "seq",
                "timestamp",
                "type",
                "data"
              ]
            }
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "description": "JSON-line stream of redacted log objects",
            "type": "object"
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "oldAgent": {
                "type": "string"
              },
              "newAgent": {
                "type": "string"
              },
              "swapped": {
                "type": "boolean"
              },
              "oldRevoked": {
                "type": "boolean"
              },
              "requiresSignature": {
                "type": "boolean"
              },
              "approval": {},
              "revokeApproval": {}
            },
            "required": [
              "oldAgent",
              "newAgent",
              "swapped",
              "oldRevoked"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "object",
            "properties": {
              "agentAddress": {
                "type": "string"
              },
              "locallyRevoked": {
                "type": "boolean"
              },
              "exchangeRevoked": {
                "type": "boolean"
              },
              "requiresSignature": {
                "type": "boolean"
              },
              "approval": {}
            },
            "required": [
              "agentAddress",
              "locallyRevoked",
              "exchangeRevoked",
              "requiresSignature",
              "approval"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "seq": {
                  "type": "integer"
                },
                "timestamp": {
                  "type": "string"
                },
                "intentId": {
                  "type": "string"
                },
                "requestId": {
                  "type": "string"
                },
                "cloid": {
                  "type": "string"
                },
                "stage": {
                  "type": "string"
                },
                "data": {},
                "previousHash": {
                  "type": "string"
                },
                "hash": {
                  "type": "string"
                }
              },
              "required": [
                "seq",
                "timestamp",
                "intentId",
                "stage",
                "data",
                "previousHash",
                "hash"
              ]
            }
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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

## skill

Install packaged version-matched skill for Claude Code or Codex

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "args": {
        "default": [
          "install"
        ],
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "target": {
        "default": "codex",
        "type": "string",
        "enum": [
          "claude",
          "codex"
        ]
      },
      "force": {
        "default": false,
        "type": "boolean"
      }
    },
    "required": [
      "args",
      "target",
      "force"
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
          "data": {
            "type": "object",
            "properties": {
              "target": {
                "enum": [
                  "claude",
                  "codex"
                ]
              },
              "path": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "changed": {
                "type": "boolean"
              }
            },
            "required": [
              "target",
              "path",
              "version",
              "changed"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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

## market

Discover market asset, precision, leverage ceiling and current mid

```json
{
  "input": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "coin": {
        "type": "string"
      }
    },
    "required": [
      "coin"
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
          "data": {
            "type": "object",
            "properties": {
              "coin": {
                "type": "string"
              },
              "asset": {
                "type": "string"
              },
              "szDecimals": {
                "type": "string"
              },
              "maxLeverage": {
                "type": "string"
              },
              "mid": {
                "type": "string"
              }
            },
            "required": [
              "coin",
              "asset",
              "szDecimals",
              "maxLeverage",
              "mid"
            ]
          }
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
            "enum": [
              "INSUFFICIENT_MARGIN",
              "POLICY_REJECTED",
              "AGENT_EXPIRED",
              "AGENT_NOT_APPROVED",
              "DEPOSIT_PENDING",
              "NONCE_COLLISION",
              "RATE_LIMIT",
              "INVALID_SIZE",
              "INVALID_PRICE",
              "UNKNOWN_MARKET",
              "ORDER_NOT_FOUND",
              "RUNNER_NOT_RUNNING",
              "CONFIG_INVALID",
              "NETWORK_ERROR",
              "UPSTREAM_ERROR",
              "INTERNAL"
            ]
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

