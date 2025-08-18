/**
 * TypeScript Utility Types for Serialization Safety
 * Provides advanced TypeScript types to prevent passing non-serializable
 * data as props or state in React components and Next.js applications.
 */

/**
 * Core serializable primitive types
 */
export type SerializablePrimitive = string | number | boolean | null;

/**
 * Non-serializable types that should be excluded
 */
type NonSerializable =
  | ((...args: never[]) => unknown)
  | symbol
  | undefined
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | Error
  | Promise<unknown>
  | ArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/**
 * Check if a type is serializable
 */
type IsSerializable<T> = T extends NonSerializable
  ? false
  : T extends SerializablePrimitive
  ? true
  : T extends Array<infer U>
  ? IsSerializable<U>
  : T extends object
  ? {
    [K in keyof T]: IsSerializable<T[K]>;
  }[keyof T] extends false
  ? false
  : true
  : false;

/**
 * Extract only serializable properties from a type
 */
export type SerializableOnly<T> = T extends NonSerializable
  ? never
  : T extends SerializablePrimitive
  ? T
  : T extends Array<infer U>
  ? Array<SerializableOnly<U>>
  : T extends object
  ? {
    [K in keyof T as IsSerializable<T[K]> extends true ? K : never]: SerializableOnly<T[K]>;
  }
  : never;

/**
 * Make all non-serializable properties optional and warn about them
 */
export type SerializableSafe<T> = T extends NonSerializable
  ? never
  : T extends SerializablePrimitive
  ? T
  : T extends Array<infer U>
  ? Array<SerializableSafe<U>>
  : T extends object
  ? {
    [K in keyof T as IsSerializable<T[K]> extends true ? K : never]: SerializableSafe<T[K]>;
  } & {
    [K in keyof T as IsSerializable<T[K]> extends false
    ? K
    : never]?: SerializableSafe<T[K]>;
  }
  : never;

/**
 * Utility type to convert non-serializable types to their serializable equivalents
 */
export type ToSerializable<T> = T extends (...args: never[]) => unknown
  ? never
  : T extends symbol
  ? never
  : T extends undefined
  ? null
  : T extends Date
  ? string // ISO string
  : T extends RegExp
  ? string // toString()
  : T extends Map<string, infer V>
  ? Record<string, ToSerializable<V>>
  : T extends Set<infer U>
  ? Array<ToSerializable<U>>
  : T extends Error
  ? { name: string; message: string; stack?: string }
  : T extends Promise<infer U>
  ? ToSerializable<U>
  : T extends Array<infer U>
  ? Array<ToSerializable<U>>
  : T extends object
  ? {
    [K in keyof T]: ToSerializable<T[K]>;
  }
  : T extends SerializablePrimitive
  ? T
  : never;

/**
 * React component props that are guaranteed to be serializable
 */
export type SerializableProps<T = Record<string, never>> = T extends object
  ? {
      [K in keyof T]: SerializableOnly<T[K]>;
    } & {
      children?: React.ReactNode;
      className?: string;
      style?: React.CSSProperties;
      key?: React.Key;
    }
  : {
      children?: React.ReactNode;
      className?: string;
      style?: React.CSSProperties;
      key?: React.Key;
    };

/**
 * Utility to check if props are serializable at type level
 */
export type ValidateSerializableProps<T> = IsSerializable<T> extends true
  ? T
  : {
    [K in keyof T]: IsSerializable<T[K]> extends false
    ? `❌ Property '${K & string}' is not serializable. Type: ${T[K] extends (...args: never[]) => unknown ? 'Function' : T[K] extends Map<unknown, unknown> ? 'Map' : T[K] extends Set<unknown> ? 'Set' : string}`
    : T[K];
  };

/**
 * State type that ensures all values are serializable
 */
export type SerializableState<T> = {
  [K in keyof T]: SerializableOnly<T[K]>;
};

/**
 * Context value type that ensures serializability
 */
export type SerializableContext<T> = SerializableOnly<T>;

/**
 * API response type that ensures serializability
 */
export type SerializableApiResponse<T> = {
  data: SerializableOnly<T>;
  status: number;
  message?: string;
  timestamp: string;
};

/**
 * Next.js page props that are guaranteed to be serializable
 */
export type SerializablePageProps<T = Record<string, never>> = {
  params?: Record<string, string>;
  searchParams?: Record<string, string | string[]>;
} & SerializableOnly<T>;

/**
 * Utility type for form data that ensures serializability
 */
export type SerializableFormData<T> = {
  [K in keyof T]: T[K] extends File
  ? never
  : T[K] extends FileList
  ? never
  : SerializableOnly<T[K]>;
};

/**
 * URL search params type that ensures serializability
 */
export type SerializableSearchParams = Record<string, string | string[] | undefined>;

/**
 * Local storage value type that ensures serializability
 */
export type SerializableStorageValue<T> = SerializableOnly<T>;

/**
 * Cookie value type that ensures serializability
 */
export type SerializableCookieValue = string | number | boolean;

/**
 * Session storage value type that ensures serializability
 */
export type SerializableSessionValue<T> = SerializableOnly<T>;

/**
 * Database record type that ensures serializability
 */
export type SerializableRecord<T> = {
  id: string | number;
  createdAt: string;
  updatedAt: string;
} & SerializableOnly<T>;

/**
 * Event payload type that ensures serializability
 */
export type SerializableEventPayload<T> = {
  type: string;
  timestamp: string;
  data: SerializableOnly<T>;
};

/**
 * Message type for postMessage that ensures serializability
 */
export type SerializableMessage<T = unknown> = {
  type: string;
  payload: SerializableOnly<T>;
  id?: string;
};

/**
 * WebSocket message type that ensures serializability
 */
export type SerializableWebSocketMessage<T = unknown> = {
  event: string;
  data: SerializableOnly<T>;
  timestamp: string;
};

/**
 * Configuration object type that ensures serializability
 */
export type SerializableConfig<T> = SerializableOnly<T>;

/**
 * Utility type to extract serializable keys from an object
 */
export type SerializableKeys<T> = {
  [K in keyof T]: IsSerializable<T[K]> extends true ? K : never;
}[keyof T];

/**
 * Utility type to extract non-serializable keys from an object
 */
export type NonSerializableKeys<T> = {
  [K in keyof T]: IsSerializable<T[K]> extends false ? K : never;
}[keyof T];

/**
 * Conditional type that shows which properties are problematic
 */
export type SerializationReport<T> = {
  serializable: Pick<T, SerializableKeys<T>>;
  nonSerializable: Pick<T, NonSerializableKeys<T>>;
};

/**
 * Type guard function signatures
 */
export interface SerializationTypeGuards {
  isSerializableValue: <T>(value: T) => boolean;
  isValidProps: <T>(props: T) => boolean;
  isValidState: <T>(state: T) => boolean;
  isValidApiResponse: <T>(response: T) => boolean;
}

/**
 * Branded type for values that have been validated as serializable
 */
export type Validated<T> = T & { readonly __validated: unique symbol };

/**
 * Utility to mark a value as validated (use with caution)
 */
export function markAsValidated<T>(value: T): Validated<SerializableOnly<T>> {
  return value as Validated<SerializableOnly<T>>;
}

/**
 * Component prop validation type
 */
export type ComponentWithSerializableProps<P> = React.ComponentType<
  ValidateSerializableProps<P>
>;

/**
 * Higher-order component type that ensures serializable props
 */
export type WithSerializableProps<P> = (
  component: React.ComponentType<P>
) => ComponentWithSerializableProps<P>;

/**
 * Hook state type that ensures serializability
 */
export type UseSerializableState<T> = [
  SerializableOnly<T>,
  (newState: SerializableOnly<T> | ((prev: SerializableOnly<T>) => SerializableOnly<T>)) => void
];

/**
 * Context provider props that ensures serializable value
 */
export type SerializableProviderProps<T> = {
  value: SerializableOnly<T>;
  children: React.ReactNode;
};

/**
 * Error boundary props with serializable error data
 */
export type SerializableErrorBoundaryProps = {
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  errorInfo: {
    componentStack: string;
  };
  children: React.ReactNode;
};

/**
 * Utility types for common Next.js patterns
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace NextJsSerializable {
  export type GetServerSidePropsResult<T> = {
    props: SerializablePageProps<T>;
  };

  export type GetStaticPropsResult<T> = {
    props: SerializablePageProps<T>;
    revalidate?: number;
  };

  export type ApiRequestBody<T> = SerializableOnly<T>;
  export type ApiResponseBody<T> = SerializableApiResponse<T>;

  export type MiddlewareData<T> = SerializableOnly<T>;
  export type RouteHandlerResponse<T> = Response & { json: () => Promise<SerializableOnly<T>> };
}

/**
 * Development-time type checking utilities
 */
export type TypeCheckSerializable<T> = IsSerializable<T> extends true
  ? '✅ Type is serializable'
  : '❌ Type contains non-serializable properties';

export type TypeCheckProps<T> = {
  [K in keyof T]: IsSerializable<T[K]> extends true
  ? '✅ Serializable'
  : '❌ Not serializable';
};

/**
 * Conditional rendering based on serializability
 */
export type RenderIfSerializable<T, SerializableComponent, NonSerializableComponent> =
  IsSerializable<T> extends true
  ? SerializableComponent
  : NonSerializableComponent;