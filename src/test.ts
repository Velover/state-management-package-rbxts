// type Primitive =
// 	| string
// 	| number
// 	| boolean
// 	| undefined
// 	| RBXObject
// 	| buffer
// 	| RaycastParams
// 	| Vector3
// 	| Vector2
// 	| CFrame
// 	| Color3
// 	| BrickColor
// 	| EnumItem
// 	| Font
// 	| ColorSequence
// 	| NumberRange
// 	| NumberSequence
// 	| UDim2
// 	| UDim
// 	| Vector2int16
// 	| Vector3int16;

// type PrimitiveObject<T extends object = object> = T & { __primitive_object: true };

// // More robust marked object detection
// type IsSpecialObject<T> = T extends object
// 	? T extends PrimitiveObject
// 		? true
// 		: // eslint-disable-next-line @typescript-eslint/no-explicit-any
// 			T extends any[]
// 			? true // Arrays are also treated as endpoints
// 			: // eslint-disable-next-line @typescript-eslint/no-explicit-any
// 				T extends (...args: any) => any
// 				? true // Functions are endpoints
// 				: false
// 	: false;

// // Recursive path builder with depth limit to prevent infinite recursion
// type BuildPaths<T, Depth extends ReadonlyArray<number> = []> = Depth["size"] extends 10 // Max depth of 10 to prevent infinite recursion
// 	? never
// 	: {
// 			[K in keyof T]: K extends string | number
// 				? T[K] extends Primitive
// 					? K
// 					: IsSpecialObject<T[K]> extends true
// 						? K
// 						: T[K] extends object
// 							? `${K}.${BuildPaths<T[K], [...Depth, 1]>}`
// 							: K
// 				: never;
// 		}[keyof T];

// type FlatKeys<T> = BuildPaths<T>;
// interface IData {
// 	energy: number;
// 	test: string[];
// 	resources: {
// 		wood: number;
// 		sub_resources: {
// 			water: number;
// 		};
// 	};
// 	specialObject: PrimitiveObject<{ value: string }>;
// 	items: string[];
// 	callback: () => void;
// }

// type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
// 	? K extends keyof T
// 		? PathValue<T[K], Rest>
// 		: never
// 	: P extends keyof T
// 		? T[P]
// 		: never;

// function TestKey<T extends FlatKeys<IData>>(key: T): PathValue<IData, T> {
// 	// This function is just for testing purposes
// 	print(`Testing key: ${key}`);
// 	return undefined!;
// }

// const v = TestKey("specialObject");
