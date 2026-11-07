/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/leash.json`.
 */
export type Leash = {
  "address": "5tbQ7LteAdDS9MTbLDqaZiHxiPsoY6EuXUoh3KBKN65n",
  "metadata": {
    "name": "leash",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Onchain spending limits for AI agents"
  },
  "instructions": [
    {
      "name": "approveSpend",
      "docs": [
        "Owner approves a pending payment: rules are re-checked (the allowlist or",
        "budget may have changed), then the vault pays and a `SpendEvent` is emitted."
      ],
      "discriminator": [
        248,
        201,
        151,
        15,
        28,
        162,
        112,
        90
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "relations": [
            "pending"
          ]
        },
        {
          "name": "pending",
          "writable": true
        },
        {
          "name": "requester",
          "writable": true,
          "relations": [
            "pending"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "policy"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipientToken",
          "writable": true,
          "relations": [
            "pending"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "closePolicy",
      "docs": [
        "Owner drains the vault, closes it and the policy, and gets the rent back."
      ],
      "discriminator": [
        55,
        42,
        248,
        229,
        222,
        138,
        26,
        252
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "policy"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createPolicy",
      "docs": [
        "Owner creates a policy for one agent key and initializes its vault ATA."
      ],
      "discriminator": [
        27,
        81,
        33,
        27,
        196,
        103,
        246,
        53
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "policyId"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "policyId",
          "type": "u64"
        },
        {
          "name": "agent",
          "type": "pubkey"
        },
        {
          "name": "perTxCap",
          "type": "u64"
        },
        {
          "name": "dailyCap",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        },
        {
          "name": "allowlist",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Owner moves tokens from their token account into the vault."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "policy"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "rejectSpend",
      "docs": [
        "Owner declines a pending payment. Nothing moves; rent goes back to the agent."
      ],
      "discriminator": [
        30,
        241,
        174,
        105,
        69,
        228,
        23,
        119
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "relations": [
            "pending"
          ]
        },
        {
          "name": "pending",
          "writable": true
        },
        {
          "name": "requester",
          "writable": true,
          "relations": [
            "pending"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "policy"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipientToken",
          "writable": true,
          "relations": [
            "pending"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "requestSpend",
      "docs": [
        "Agent asks the owner to approve a payment above `approval_threshold`.",
        "The same rules as `spend` apply; nothing moves until `approve_spend`."
      ],
      "discriminator": [
        127,
        12,
        23,
        75,
        137,
        178,
        148,
        71
      ],
      "accounts": [
        {
          "name": "agent",
          "writable": true,
          "signer": true
        },
        {
          "name": "policy"
        },
        {
          "name": "pending",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "arg",
                "path": "requestId"
              }
            ]
          }
        },
        {
          "name": "recipientToken",
          "docs": [
            "Destination token account; checked against the allowlist in `request_spend`."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "rotateAgent",
      "docs": [
        "Owner replaces the agent key, instantly revoking the old one."
      ],
      "discriminator": [
        182,
        91,
        147,
        107,
        155,
        47,
        150,
        176
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newAgent",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setAllowlist",
      "docs": [
        "Owner replaces the recipient allowlist (max 8 wallets)."
      ],
      "discriminator": [
        141,
        30,
        41,
        131,
        132,
        7,
        216,
        134
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "allowlist",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "setApprovalThreshold",
      "docs": [
        "Owner sets the amount above which a payment needs approval (0 = never)."
      ],
      "discriminator": [
        136,
        178,
        240,
        249,
        212,
        42,
        150,
        63
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "threshold",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Kill switch: while paused the agent cannot spend. The owner still can withdraw."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "spend",
      "docs": [
        "Agent pays a recipient from the vault. Every rule is checked here, in",
        "order, each with its own error. `request_id` binds the payment to one",
        "API request (the 402 nonce); `reason_hash` is sha256 of the agent's",
        "stated reason, so anyone can audit why it paid."
      ],
      "discriminator": [
        242,
        205,
        255,
        87,
        101,
        217,
        245,
        57
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true
        },
        {
          "name": "policy",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "policy"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipientToken",
          "docs": [
            "Destination token account; its owner must be allowlisted (checked in `spend`)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "updateLimits",
      "docs": [
        "Owner changes the caps and expiry."
      ],
      "discriminator": [
        89,
        37,
        137,
        60,
        75,
        70,
        48,
        194
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "perTxCap",
          "type": "u64"
        },
        {
          "name": "dailyCap",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Owner pulls tokens from the vault back to their own token account."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "policy"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "pendingSpend",
      "discriminator": [
        193,
        205,
        85,
        66,
        25,
        3,
        67,
        134
      ]
    },
    {
      "name": "policy",
      "discriminator": [
        222,
        135,
        7,
        163,
        235,
        177,
        33,
        68
      ]
    }
  ],
  "events": [
    {
      "name": "approvalRejected",
      "discriminator": [
        113,
        40,
        207,
        170,
        194,
        195,
        17,
        217
      ]
    },
    {
      "name": "approvalRequested",
      "discriminator": [
        114,
        39,
        81,
        245,
        166,
        50,
        236,
        254
      ]
    },
    {
      "name": "spendEvent",
      "discriminator": [
        53,
        88,
        173,
        183,
        74,
        205,
        27,
        182
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "policyPaused",
      "msg": "Policy is paused by its owner"
    },
    {
      "code": 6001,
      "name": "policyExpired",
      "msg": "Policy has expired"
    },
    {
      "code": 6002,
      "name": "unauthorizedAgent",
      "msg": "Signer is not the policy's agent"
    },
    {
      "code": 6003,
      "name": "recipientNotAllowed",
      "msg": "Recipient is not on the allowlist"
    },
    {
      "code": 6004,
      "name": "overPerTxCap",
      "msg": "Amount is zero or above the per-transaction cap"
    },
    {
      "code": 6005,
      "name": "overDailyCap",
      "msg": "Amount would exceed the daily cap"
    },
    {
      "code": 6006,
      "name": "allowlistTooLong",
      "msg": "Allowlist has more than 8 entries"
    },
    {
      "code": 6007,
      "name": "invalidLimits",
      "msg": "Caps must be > 0 and per-tx cap <= daily cap"
    },
    {
      "code": 6008,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6009,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6010,
      "name": "needsApproval",
      "msg": "Amount is above the approval threshold: use request_spend"
    },
    {
      "code": 6011,
      "name": "approvalNotRequired",
      "msg": "Amount is within the approval threshold: use spend"
    }
  ],
  "types": [
    {
      "name": "approvalRejected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "pending",
            "type": "pubkey"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "approvalRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "pending",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pendingSpend",
      "docs": [
        "A payment waiting for the owner. PDA seeds: `[\"pending\", policy, request_id]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "requester",
            "type": "pubkey"
          },
          {
            "name": "recipientToken",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "policy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "policyId",
            "type": "u64"
          },
          {
            "name": "perTxCap",
            "type": "u64"
          },
          {
            "name": "dailyCap",
            "type": "u64"
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "totalSpent",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "allowlist",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "approvalThreshold",
            "docs": [
              "Payments above this need the owner's approval (0 = never)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "spendEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "docs": [
              "Recipient wallet (owner of the destination token account)."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
