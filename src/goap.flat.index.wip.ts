type Primitive =
	| Axes
	| BrickColor
	| CFrame
	| Color3
	| ColorSequence
	| ColorSequenceKeypoint
	| DateTime
	| DockWidgetPluginGuiInfo
	| Enum
	| EnumItem
	| Enums
	| Faces
	| FloatCurveKey
	| Font
	| Instance
	| NumberRange
	| NumberSequence
	| NumberSequenceKeypoint
	| OverlapParams
	| PathWaypoint
	| PhysicalProperties
	| Random
	| Ray
	| RaycastParams
	| RaycastResult
	| RBXScriptConnection
	| RBXScriptSignal
	| Rect
	| Region3
	| Region3int16
	| TweenInfo
	| UDim
	| UDim2
	| Vector2
	| Vector2int16
	| Vector3int16
	| undefined
	| boolean
	| string
	| number
	| Callback
	| thread
	| Vector3
	| buffer;
type PrimitiveObject<T extends object = object> = T & { __primitive_object: true };

// More robust marked object detection
type IsSpecialObject<T> = T extends object
	? T extends PrimitiveObject
		? true
		: // eslint-disable-next-line @typescript-eslint/no-explicit-any
			T extends any[]
			? true // Arrays are also treated as endpoints
			: // eslint-disable-next-line @typescript-eslint/no-explicit-any
				T extends (...args: any) => any
				? true // Functions are endpoints
				: false
	: false;

// Recursive path builder with depth limit to prevent infinite recursion
type BuildPaths<T, Depth extends ReadonlyArray<number> = []> = Depth["size"] extends 10 // Max depth of 10 to prevent infinite recursion
	? never
	: {
			[K in keyof T]: K extends string | number
				? T[K] extends Primitive
					? K
					: IsSpecialObject<T[K]> extends true
						? K
						: T[K] extends object
							? `${K}.${BuildPaths<T[K], [...Depth, 1]>}`
							: K
				: never;
		}[keyof T];

type FlatKeys<T> = BuildPaths<T>;
type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
	? K extends keyof T
		? PathValue<T[K], Rest>
		: never
	: P extends keyof T
		? T[P]
		: never;

export function ToPrimitiveObject<T extends object>(obj: T): PrimitiveObject<{ value: T }> {
	return {
		value: obj,
		__primitive_object: true,
	};
}

export function IsPrimitiveObject(v: object): v is PrimitiveObject {
	return (v as PrimitiveObject).__primitive_object === true;
}
