/**
 * Comprehensive serialization utilities for Next.js applications
 * Helps detect and prevent Set/Map serialization errors
 */

export type SerializationIssue = {
  path: string;
  type: string;
  value: unknown;
  suggestion: string;
  reason: string;
};

/**
 * Detects non-serializable objects in data structures
 */
export function detectNonSerializable(
  obj: unknown,
  path = 'root',
  visited = new WeakSet(),
  depth = 0
): SerializationIssue[] {
  const issues: SerializationIssue[] = [];

  if (obj === null || obj === undefined) return issues;

  // Prevent infinite recursion with both visited set and depth limit
  if (depth > 10 || (typeof obj === 'object' && visited.has(obj))) {
    if (depth > 10) {
      issues.push({
        path,
        type: 'max-depth-exceeded',
        value: '[Max depth exceeded]',
        suggestion: 'Reduce object nesting depth',
        reason: 'Object nesting too deep'
      });
    } else {
      issues.push({
        path,
        type: 'circular-reference',
        value: obj,
        suggestion: 'Remove circular references or use a different data structure',
        reason: 'Circular references are not serializable'
      });
    }
    return issues;
  }

  if (typeof obj === 'object') {
    visited.add(obj);
  }

  // Check for problematic types
  if (obj instanceof Set) {
    issues.push({
      path,
      type: 'Set',
      value: obj,
      suggestion: 'Convert to Array: Array.from(set)',
      reason: 'Set objects are not serializable'
    });
  } else if (obj instanceof Map) {
    issues.push({
      path,
      type: 'Map',
      value: obj,
      suggestion: 'Convert to Object: Object.fromEntries(map)',
      reason: 'Map objects are not serializable'
    });
  } else if (obj instanceof Date) {
    issues.push({
      path,
      type: 'Date',
      value: obj,
      suggestion: 'Convert to ISO string: date.toISOString()',
      reason: 'Date objects are not serializable'
    });
  } else if (obj instanceof RegExp) {
    issues.push({
      path,
      type: 'RegExp',
      value: obj,
      suggestion: 'Convert to string: regex.toString()',
      reason: 'RegExp objects are not serializable'
    });
  } else if (typeof obj === 'function') {
    issues.push({
      path,
      type: 'function',
      value: obj,
      suggestion: 'Remove function or convert to serializable data',
      reason: 'Functions are not serializable'
    });
  } else if (typeof obj === 'symbol') {
    issues.push({
      path,
      type: 'symbol',
      value: obj,
      suggestion: 'Convert to string: symbol.toString()',
      reason: 'Symbols are not serializable'
    });
  } else if (obj instanceof Error) {
    issues.push({
      path,
      type: 'Error',
      value: obj,
      suggestion: 'Convert to plain object: { name, message, stack }',
      reason: 'Error objects are not serializable'
    });
  } else if (typeof obj === 'object' && obj.constructor !== Object && obj.constructor !== Array) {
    // Custom class instances
    issues.push({
      path,
      type: 'custom-class',
      value: obj,
      suggestion: 'Convert to plain object or implement toJSON() method',
      reason: 'Custom class instances are not serializable'
    });
  }

  // Recursively check object properties
  if (typeof obj === 'object' && obj !== null) {
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        issues.push(...detectNonSerializable(item, `${path}[${index}]`, visited, depth + 1));
      });
    } else {
      Object.entries(obj).forEach(([key, value]) => {
        issues.push(...detectNonSerializable(value, `${path}.${key}`, visited, depth + 1));
      });
    }
  }

  return issues;
}

/**
 * Attempts to safely stringify an object, providing detailed error information
 */
export function safeStringify(obj: unknown): { success: boolean; result?: string; issues: SerializationIssue[] } {
  try {
    const result = JSON.stringify(obj);
    return { success: true, result, issues: [] };
  } catch {
    const issues = detectNonSerializable(obj);
    return { success: false, issues };
  }
}

/**
 * Converts non-serializable objects to serializable equivalents
 */
export function makeSerializable(obj: unknown, visited = new WeakSet(), depth = 0): unknown {
  if (obj === null || obj === undefined) return obj;

  // Prevent infinite recursion with depth limit
  if (depth > 10 || (typeof obj === 'object' && visited.has(obj))) {
    return depth > 10 ? '[Max Depth]' : '[Circular Reference]';
  }

  if (typeof obj === 'object') {
    visited.add(obj);
  }

  // Convert problematic types
  if (obj instanceof Set) {
    return Array.from(obj);
  } else if (obj instanceof Map) {
    return Object.fromEntries(obj);
  } else if (obj instanceof Date) {
    return obj.toISOString();
  } else if (obj instanceof RegExp) {
    return obj.toString();
  } else if (typeof obj === 'function') {
    return '[Function]';
  } else if (typeof obj === 'symbol') {
    return obj.toString();
  } else if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      stack: obj.stack
    };
  } else if (typeof obj === 'object' && obj.constructor !== Object && obj.constructor !== Array) {
    // Try to serialize custom class instances
    if (typeof (obj as Record<string, unknown>).toJSON === 'function') {
      return (obj as { toJSON: () => unknown }).toJSON();
    }
    // Fallback to extracting enumerable properties
    const serializable: Record<string, unknown> = {};
    Object.getOwnPropertyNames(obj).forEach(key => {
      try {
        const value = (obj as Record<string, unknown>)[key];
        if (typeof value !== 'function') {
          serializable[key] = makeSerializable(value, visited, depth + 1);
        }
      } catch {
        // Skip properties that can't be accessed
      }
    });
    return serializable;
  }

  // Recursively process objects and arrays
  if (typeof obj === 'object' && obj !== null) {
    if (Array.isArray(obj)) {
      return obj.map(item => makeSerializable(item, visited, depth + 1));
    } else {
      const serializable: Record<string, unknown> = {};
      Object.entries(obj).forEach(([key, value]) => {
        serializable[key] = makeSerializable(value, visited, depth + 1);
      });
      return serializable;
    }
  }

  return obj;
}

/**
 * Development helper to log serialization issues with helpful suggestions
 */
export function logSerializationIssues(obj: unknown, label = 'Object'): void {
  if (process.env.NODE_ENV !== 'development') return;

  const issues = detectNonSerializable(obj);
  if (issues.length === 0) {
    console.log(`✅ ${label} is serialization-safe`);
    return;
  }

  console.group(`🚨 Serialization issues found in ${label}:`);
  issues.forEach(issue => {
    console.error(`❌ ${issue.path}: ${issue.type}`);
    console.log(`💡 Suggestion: ${issue.suggestion}`);
    console.log(`📍 Value:`, makeSerializable(issue.value));
  });
  console.groupEnd();
}

/**
 * Creates a serialization-safe version of an object for debugging
 */
export function createSerializationSafeDebugObject(obj: unknown): unknown {
  return makeSerializable(obj);
}

/**
 * Validates that an object can be safely passed as props between components
 */
export function validateComponentProps(props: unknown, componentName?: string): boolean {
  const issues = detectNonSerializable(props, 'props');
  if (issues.length > 0 && process.env.NODE_ENV === 'development') {
    console.error(`🚨 Non-serializable props detected in component ${componentName || 'Unknown'}:`);
    issues.forEach(issue => {
      console.error(`  - ${issue.path}: ${issue.type} (${issue.suggestion})`);
    });
    return false;
  }
  return true;
}