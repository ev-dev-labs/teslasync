#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function walk(target, extensions) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return extensions.has(path.extname(target)) && !isTestFile(target) ? [target] : [];
  }

  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      return walk(entryPath, extensions);
    }
    return extensions.has(path.extname(entry.name)) && !isTestFile(entry.name) ? [entryPath] : [];
  });
}

function isTestFile(file) {
  return /\.(?:test|spec)\.[^.]+$/.test(file) || file.endsWith('.d.ts');
}

function relative(file) {
  return path.relative(process.cwd(), file).replaceAll(path.sep, '/');
}

function unique(values) {
  return [...new Set(values)];
}

function crossProduct(left, right) {
  const values = [];
  for (const leftValue of left) {
    for (const rightValue of right) {
      values.push(`${leftValue}${rightValue}`);
    }
  }
  return unique(values);
}

function loadTypeScript() {
  try {
    return require(require.resolve('typescript', {
      paths: [path.resolve(process.cwd(), 'web')],
    }));
  } catch (error) {
    console.error('Unable to load TypeScript from web/node_modules. Run npm install in web first.');
    process.exitCode = 2;
    return null;
  }
}

function unwrapTypeScriptExpression(ts, node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function requestPaths(target) {
  const ts = loadTypeScript();
  if (!ts) {
    return [];
  }

  const rows = [];
  for (const file of walk(target, new Set(['.ts', '.tsx']))) {
    const sourceText = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const initializers = new Map();

    function indexInitializers(node) {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
      ) {
        initializers.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, indexInitializers);
    }

    function fragments(node, seen = new Set()) {
      const expression = unwrapTypeScriptExpression(ts, node);

      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return [expression.text];
      }
      if (ts.isTemplateExpression(expression)) {
        let values = [expression.head.text];
        for (const span of expression.templateSpans) {
          values = crossProduct(values, fragments(span.expression, seen));
          values = values.map((value) => `${value}${span.literal.text}`);
        }
        return unique(values);
      }
      if (ts.isConditionalExpression(expression)) {
        return unique([
          ...fragments(expression.whenTrue, seen),
          ...fragments(expression.whenFalse, seen),
        ]);
      }
      if (
        ts.isBinaryExpression(expression)
        && expression.operatorToken.kind === ts.SyntaxKind.PlusToken
      ) {
        return crossProduct(
          fragments(expression.left, seen),
          fragments(expression.right, seen),
        );
      }
      if (ts.isIdentifier(expression) && initializers.has(expression.text)) {
        if (seen.has(expression.text)) {
          return ['{PARAM}'];
        }
        const nextSeen = new Set(seen);
        nextSeen.add(expression.text);
        return fragments(initializers.get(expression.text), nextSeen);
      }
      return ['{PARAM}'];
    }

    function pathsFromArgument(node, seen = new Set()) {
      const expression = unwrapTypeScriptExpression(ts, node);
      if (ts.isConditionalExpression(expression)) {
        return unique([
          ...pathsFromArgument(expression.whenTrue, seen),
          ...pathsFromArgument(expression.whenFalse, seen),
        ]);
      }
      if (ts.isCallExpression(expression)) {
        return unique(expression.arguments.flatMap((argument) => pathsFromArgument(argument, seen)));
      }
      if (ts.isIdentifier(expression) && initializers.has(expression.text)) {
        if (seen.has(expression.text)) {
          return [];
        }
        const nextSeen = new Set(seen);
        nextSeen.add(expression.text);
        return pathsFromArgument(initializers.get(expression.text), nextSeen);
      }
      return fragments(expression, seen).filter((value) => value.startsWith('/'));
    }

    function visit(node) {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'request'
        && node.arguments.length > 0
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        for (const requestPath of pathsFromArgument(node.arguments[0])) {
          rows.push(`${relative(file)}:${line}\t${requestPath.replace(/\s+/g, '')}`);
        }
      }
      ts.forEachChild(node, visit);
    }

    indexInitializers(sourceFile);
    visit(sourceFile);
  }

  return unique(rows).sort();
}

function stripGoComments(line, state) {
  let output = '';
  let quote = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (state.blockComment) {
      if (character === '*' && next === '/') {
        state.blockComment = false;
        output += '  ';
        index += 1;
      } else {
        output += ' ';
      }
      continue;
    }
    if (quote) {
      output += character;
      if (quote !== '`' && escaped) {
        escaped = false;
      } else if (quote !== '`' && character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      output += ' '.repeat(line.length - index);
      break;
    }
    if (character === '/' && next === '*') {
      state.blockComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    if (character === '"' || character === '\'' || character === '`') {
      quote = character;
    }
    output += character;
  }

  return output;
}

function braceDelta(line) {
  let delta = 0;
  let quote = null;
  let escaped = false;
  for (const character of line) {
    if (quote) {
      if (quote !== '`' && escaped) {
        escaped = false;
      } else if (quote !== '`' && character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === '\'' || character === '`') {
      quote = character;
    } else if (character === '{') {
      delta += 1;
    } else if (character === '}') {
      delta -= 1;
    }
  }
  return delta;
}

function joinRoute(prefixes, leaf) {
  const joined = [...prefixes, leaf]
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function normalizeRoute(route) {
  let normalized = route.replace(/^\/api\/v1(?=\/|$)/, '');
  normalized = normalized.replace(/\{[^}]+\}/g, '{PARAM}');
  normalized = normalized.replace(/\/+/g, '/');
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/$/, '');
  }
  return normalized || '/';
}

function routerPaths(targets) {
  const routes = [];
  const methodPattern = /(?:\.|\b)(?:Get|Post|Put|Delete|Patch|Head|Options)\(\s*"([^"]*)"/g;

  for (const target of targets) {
    for (const file of walk(target, new Set(['.go']))) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const commentState = { blockComment: false };
      const frames = [];
      const helperRoutes = new Map();
      const localRouteHelpers = new Map();
      let depth = 0;
      let currentFunction = null;
      let currentLocalRouteHelper = null;
      let pendingMethodPrefix = null;

      for (const sourceLine of lines) {
        while (frames.length > 0 && depth < frames[frames.length - 1].bodyDepth) {
          frames.pop();
        }
        if (currentFunction && depth < currentFunction.bodyDepth) {
          currentFunction = null;
        }
        if (
          currentLocalRouteHelper &&
          depth < currentLocalRouteHelper.bodyDepth
        ) {
          currentLocalRouteHelper = null;
        }

        const line = stripGoComments(sourceLine, commentState);
        const prefixes = frames.map((frame) => frame.path);

        if (pendingMethodPrefix) {
          const pathMatch = line.match(/^\s*"([^"]*)"/);
          if (pathMatch) {
            const route = normalizeRoute(joinRoute(pendingMethodPrefix.prefixes, pathMatch[1]));
            routes.push(route);
            if (pendingMethodPrefix.helperName) {
              helperRoutes.get(pendingMethodPrefix.helperName).push(route);
            }
            pendingMethodPrefix = null;
          } else if (line.trim()) {
            pendingMethodPrefix = null;
          }
        }

        methodPattern.lastIndex = 0;
        let methodMatch = methodPattern.exec(line);
        while (methodMatch) {
          const route = normalizeRoute(joinRoute(prefixes, methodMatch[1]));
          routes.push(route);
          if (currentFunction) {
            helperRoutes.get(currentFunction.name).push(route);
          }
          methodMatch = methodPattern.exec(line);
        }
        if (/(?:\.|\b)(?:Get|Post|Put|Delete|Patch|Head|Options)\(\s*$/.test(line)) {
          pendingMethodPrefix = {
            prefixes,
            helperName: currentFunction?.name ?? null,
          };
        }

        if (currentLocalRouteHelper) {
          const parameter = currentLocalRouteHelper.pathParameter.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&',
          );
          const dynamicMethodPattern = new RegExp(
            `(?:\\.|\\b)(?:Get|Post|Put|Delete|Patch|Head|Options)\\(\\s*${parameter}(?:\\s*\\+\\s*"([^"]*)")?`,
            'g',
          );
          for (const dynamicMatch of line.matchAll(dynamicMethodPattern)) {
            currentLocalRouteHelper.suffixes.add(dynamicMatch[1] ?? '');
          }
        }

        const localHelperCall = line.match(
          /^\s*([A-Za-z_]\w*)\(\s*"([^"]+)"/,
        );
        if (localHelperCall) {
          const helper = localRouteHelpers.get(localHelperCall[1]);
          if (helper) {
            for (const suffix of helper.suffixes) {
              routes.push(
                normalizeRoute(
                  joinRoute(prefixes, `${localHelperCall[2]}${suffix}`),
                ),
              );
            }
          }
        }

        for (const helperCall of line.matchAll(/\b([A-Za-z_]\w*)\(\s*r\s*(?:,|\))/g)) {
          const registered = helperRoutes.get(helperCall[1]);
          if (registered) {
            for (const helperRoute of registered) {
              routes.push(normalizeRoute(joinRoute(prefixes, helperRoute)));
            }
          }
        }

        const routeMatch = line.match(/\br\.Route\(\s*"([^"]+)"\s*,\s*func\b/);
        const functionMatch = line.match(
          /^\s*func(?:\s+\([^)]*\))?\s+([A-Za-z_]\w*)\s*\(\s*r\s+chi\.Router\b/,
        );
        const localRouteHelperMatch = line.match(
          /\b([A-Za-z_]\w*)\s*:=\s*func\(\s*([A-Za-z_]\w*)\s+string\b/,
        );
        const nextDepth = depth + braceDelta(line);
        if (routeMatch) {
          frames.push({ path: routeMatch[1], bodyDepth: nextDepth });
        }
        if (functionMatch) {
          currentFunction = { name: functionMatch[1], bodyDepth: nextDepth };
          helperRoutes.set(functionMatch[1], []);
        }
        if (localRouteHelperMatch) {
          currentLocalRouteHelper = {
            name: localRouteHelperMatch[1],
            pathParameter: localRouteHelperMatch[2],
            bodyDepth: nextDepth,
            suffixes: new Set(),
          };
          localRouteHelpers.set(
            localRouteHelperMatch[1],
            currentLocalRouteHelper,
          );
        }
        depth = nextDepth;
      }
    }
  }

  return unique(routes).sort();
}

const [mode, ...targets] = process.argv.slice(2);
if (!mode || targets.length === 0 || !['requests', 'routes'].includes(mode)) {
  console.error('Usage: node contract-paths.cjs <requests|routes> <path> [path...]');
  process.exit(2);
}

const results = mode === 'requests' ? requestPaths(targets[0]) : routerPaths(targets);
if (process.exitCode !== 2) {
  process.stdout.write(results.join('\n'));
  if (results.length > 0) {
    process.stdout.write('\n');
  }
}
