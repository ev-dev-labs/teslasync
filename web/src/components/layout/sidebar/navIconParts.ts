/** Lucide path data, ISC licensed (lucide-react v0.363.0).
 * Derived from the installed lucide-react/dist/esm/icons sources; see
 * docs/nav-motion/lucide-license.txt. Paths stay static; only part transforms move.
 */
export type NavNode = readonly [string, Readonly<Record<string, string>>]
export interface NavGlyph { lucideName: string; parts: readonly { origin: readonly [number, number]; nodes: readonly NavNode[] }[]; static?: readonly NavNode[] }
export const NAV_ICON_PARTS = {
  "home": {
    "lucideName": "layout-template",
    "parts": [
      {
        "origin": [
          7.5,
          6.5
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M12 3H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8"
            }
          ]
        ]
      },
      {
        "origin": [
          16.5,
          6.5
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M12 3h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-8"
            }
          ]
        ]
      },
      {
        "origin": [
          7.5,
          17.5
        ],
        "nodes": [
          [
            "rect",
            {
              "width": "9",
              "height": "7",
              "x": "3",
              "y": "14",
              "rx": "1"
            }
          ]
        ]
      },
      {
        "origin": [
          18.5,
          17.5
        ],
        "nodes": [
          [
            "rect",
            {
              "width": "5",
              "height": "7",
              "x": "16",
              "y": "14",
              "rx": "1"
            }
          ]
        ]
      }
    ]
  },
  "vehicles": {
    "lucideName": "car-front",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"
            }
          ],
          [
            "path",
            {
              "d": "M7 14h.01"
            }
          ],
          [
            "path",
            {
              "d": "M17 14h.01"
            }
          ],
          [
            "rect",
            {
              "width": "18",
              "height": "8",
              "x": "3",
              "y": "10",
              "rx": "2"
            }
          ]
        ]
      },
      {
        "origin": [
          5,
          19
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M5 18v2"
            }
          ]
        ]
      },
      {
        "origin": [
          19,
          19
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M19 18v2"
            }
          ]
        ]
      }
    ]
  },
  "driving": {
    "lucideName": "navigation",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M3 11 22 2 13 21"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M13 21 11 13 3 11"
            }
          ]
        ]
      }
    ]
  },
  "charging": {
    "lucideName": "plug",
    "parts": [
      {
        "origin": [
          12,
          5
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M9 8V2"
            }
          ],
          [
            "path",
            {
              "d": "M15 8V2"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          19.5
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M12 22v-5"
            }
          ]
        ]
      }
    ]
  },
  "battery": {
    "lucideName": "battery-charging",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M15 7h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"
            }
          ],
          [
            "path",
            {
              "d": "M6 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1"
            }
          ],
          [
            "line",
            {
              "x1": "22",
              "x2": "22",
              "y1": "11",
              "y2": "13"
            }
          ]
        ]
      },
      {
        "origin": [
          10,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "m11 7-3 5h4l-3 5"
            }
          ]
        ]
      }
    ]
  },
  "energy": {
    "lucideName": "bolt",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "12",
              "cy": "12",
              "r": "4"
            }
          ]
        ]
      }
    ]
  },
  "cabin": {
    "lucideName": "armchair",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"
            }
          ],
          [
            "path",
            {
              "d": "M5 18v2"
            }
          ],
          [
            "path",
            {
              "d": "M19 18v2"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          13
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z"
            }
          ]
        ]
      }
    ]
  },
  "reports": {
    "lucideName": "bar-chart-3",
    "parts": [
      {
        "origin": [
          3,
          21
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M3 3v18h18"
            }
          ]
        ]
      },
      {
        "origin": [
          8,
          17
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M8 17v-3"
            }
          ]
        ]
      },
      {
        "origin": [
          13,
          17
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M13 17V5"
            }
          ]
        ]
      },
      {
        "origin": [
          18,
          17
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M18 17V9"
            }
          ]
        ]
      }
    ]
  },
  "service": {
    "lucideName": "wrench",
    "parts": [
      {
        "origin": [
          16.5,
          7.5
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M13.53 13.47l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91"
            }
          ]
        ]
      },
      {
        "origin": [
          16.5,
          7.5
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94"
            }
          ],
          [
            "path",
            {
              "d": "M10.53 10.47a6 6 0 0 1 7.94-7.94l-3.76 3.76L14.7 6.3"
            }
          ]
        ]
      }
    ]
  },
  "commands": {
    "lucideName": "terminal",
    "parts": [
      {
        "origin": [
          10,
          11
        ],
        "nodes": [
          [
            "polyline",
            {
              "points": "4 17 10 11 4 5"
            }
          ]
        ]
      },
      {
        "origin": [
          16,
          19
        ],
        "nodes": [
          [
            "line",
            {
              "x1": "12",
              "x2": "20",
              "y1": "19",
              "y2": "19"
            }
          ]
        ]
      }
    ]
  },
  "automation": {
    "lucideName": "workflow",
    "parts": [
      {
        "origin": [
          7,
          7
        ],
        "nodes": [
          [
            "rect",
            {
              "width": "8",
              "height": "8",
              "x": "3",
              "y": "3",
              "rx": "2"
            }
          ]
        ]
      },
      {
        "origin": [
          10,
          14
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M7 11v4a2 2 0 0 0 2 2h4"
            }
          ]
        ]
      },
      {
        "origin": [
          17,
          17
        ],
        "nodes": [
          [
            "rect",
            {
              "width": "8",
              "height": "8",
              "x": "13",
              "y": "13",
              "rx": "2"
            }
          ]
        ]
      }
    ]
  },
  "inbox": {
    "lucideName": "inbox",
    "parts": [
      {
        "origin": [
          12,
          14
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "polyline",
            {
              "points": "22 12 16 12 14 15 10 15 8 12 2 12"
            }
          ]
        ]
      }
    ]
  },
  "security": {
    "lucideName": "lock",
    "parts": [
      {
        "origin": [
          12,
          16.5
        ],
        "nodes": [
          [
            "rect",
            {
              "width": "18",
              "height": "11",
              "x": "3",
              "y": "11",
              "rx": "2",
              "ry": "2"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          7
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M7 11V7a5 5 0 0 1 10 0v4"
            }
          ]
        ]
      }
    ]
  },
  "advanced": {
    "lucideName": "sparkle",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "m3 12 5.8 1.9a2 2 0 0 1 1.288 1.287L12 21"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "m12 21 1.9-5.8a2 2 0 0 1 1.287-1.288L21 12"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "m21 12-5.8-1.9a2 2 0 0 1-1.288-1.287L12 3"
            }
          ]
        ]
      }
    ]
  },
  "ownership": {
    "lucideName": "handshake",
    "parts": [
      {
        "origin": [
          6,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "m11 17 2 2a1 1 0 1 0 3-3"
            }
          ],
          [
            "path",
            {
              "d": "M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"
            }
          ],
          [
            "path",
            {
              "d": "M3 4h8"
            }
          ]
        ]
      },
      {
        "origin": [
          18,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"
            }
          ],
          [
            "path",
            {
              "d": "m21 3 1 11h-2"
            }
          ]
        ]
      }
    ]
  },
  "physics": {
    "lucideName": "atom",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "12",
              "cy": "12",
              "r": "1"
            }
          ]
        ]
      }
    ]
  },
  "data": {
    "lucideName": "database",
    "parts": [
      {
        "origin": [
          12,
          5
        ],
        "nodes": [
          [
            "ellipse",
            {
              "cx": "12",
              "cy": "5",
              "rx": "9",
              "ry": "3"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M3 12A9 3 0 0 0 21 12"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          19
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M3 5V19A9 3 0 0 0 21 19V5"
            }
          ]
        ]
      }
    ]
  },
  "diagnostics": {
    "lucideName": "stethoscope",
    "parts": [
      {
        "origin": [
          8,
          9
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"
            }
          ]
        ]
      },
      {
        "origin": [
          14,
          15
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4"
            }
          ]
        ]
      },
      {
        "origin": [
          20,
          10
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "20",
              "cy": "10",
              "r": "2"
            }
          ]
        ]
      }
    ]
  },
  "account": {
    "lucideName": "user",
    "parts": [
      {
        "origin": [
          12,
          7
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "12",
              "cy": "7",
              "r": "4"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          19
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
            }
          ]
        ]
      }
    ]
  },
  "settings": {
    "lucideName": "cog",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"
            }
          ],
          [
            "path",
            {
              "d": "M12 2v2"
            }
          ],
          [
            "path",
            {
              "d": "M12 22v-2"
            }
          ],
          [
            "path",
            {
              "d": "m17 20.66-1-1.73"
            }
          ],
          [
            "path",
            {
              "d": "M11 10.27 7 3.34"
            }
          ],
          [
            "path",
            {
              "d": "m20.66 17-1.73-1"
            }
          ],
          [
            "path",
            {
              "d": "m3.34 7 1.73 1"
            }
          ],
          [
            "path",
            {
              "d": "M14 12h8"
            }
          ],
          [
            "path",
            {
              "d": "M2 12h2"
            }
          ],
          [
            "path",
            {
              "d": "m20.66 7-1.73 1"
            }
          ],
          [
            "path",
            {
              "d": "m3.34 17 1.73-1"
            }
          ],
          [
            "path",
            {
              "d": "m17 3.34-1 1.73"
            }
          ],
          [
            "path",
            {
              "d": "m11 13.73-4 6.93"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
            }
          ]
        ]
      }
    ]
  },
  "connect": {
    "lucideName": "network",
    "parts": [
      {
        "origin": [
          12,
          5
        ],
        "nodes": [
          [
            "rect",
            {
              "x": "9",
              "y": "2",
              "width": "6",
              "height": "6",
              "rx": "1"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"
            }
          ],
          [
            "path",
            {
              "d": "M12 12V8"
            }
          ]
        ]
      },
      {
        "origin": [
          5,
          19
        ],
        "nodes": [
          [
            "rect",
            {
              "x": "2",
              "y": "16",
              "width": "6",
              "height": "6",
              "rx": "1"
            }
          ]
        ]
      },
      {
        "origin": [
          19,
          19
        ],
        "nodes": [
          [
            "rect",
            {
              "x": "16",
              "y": "16",
              "width": "6",
              "height": "6",
              "rx": "1"
            }
          ]
        ]
      }
    ]
  },
  "about": {
    "lucideName": "info",
    "parts": [
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "12",
              "cy": "12",
              "r": "10"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          14
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M12 16v-4"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          8
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M12 8h.01"
            }
          ]
        ]
      }
    ]
  },
  "alerts": {
    "lucideName": "bell-ring",
    "parts": [
      {
        "origin": [
          12,
          4
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          19
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M10.3 21a1.94 1.94 0 0 0 3.4 0"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          8
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M4 2C2.8 3.7 2 5.7 2 8"
            }
          ],
          [
            "path",
            {
              "d": "M22 8c0-2.3-.8-4.3-2-6"
            }
          ]
        ]
      }
    ]
  },
  "display": {
    "lucideName": "palette",
    "parts": [
      {
        "origin": [
          8.5,
          7.5
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "8.5",
              "cy": "7.5",
              "r": ".5"
            }
          ]
        ]
      },
      {
        "origin": [
          13.5,
          6.5
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "13.5",
              "cy": "6.5",
              "r": ".5"
            }
          ]
        ]
      },
      {
        "origin": [
          17.5,
          10.5
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "17.5",
              "cy": "10.5",
              "r": ".5"
            }
          ]
        ]
      },
      {
        "origin": [
          6.5,
          12.5
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "6.5",
              "cy": "12.5",
              "r": ".5"
            }
          ]
        ]
      }
    ],
    "static": [
      [
        "path",
        {
          "d": "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"
        }
      ]
    ]
  },
  "avatar": {
    "lucideName": "user",
    "parts": [
      {
        "origin": [
          12,
          7
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "12",
              "cy": "7",
              "r": "4"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          19
        ],
        "nodes": [
          [
            "path",
            {
              "d": "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
            }
          ]
        ]
      }
    ]
  },
  "more": {
    "lucideName": "ellipsis",
    "parts": [
      {
        "origin": [
          5,
          12
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "5",
              "cy": "12",
              "r": "1"
            }
          ]
        ]
      },
      {
        "origin": [
          12,
          12
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "12",
              "cy": "12",
              "r": "1"
            }
          ]
        ]
      },
      {
        "origin": [
          19,
          12
        ],
        "nodes": [
          [
            "circle",
            {
              "cx": "19",
              "cy": "12",
              "r": "1"
            }
          ]
        ]
      }
    ]
  }
} as const satisfies Record<string, NavGlyph>
