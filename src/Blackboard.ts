//!native
//!optimize 2

export class Blackboard<TRecord extends object = object> {
	protected data_ = new Map<string, unknown>();

	constructor(initial_data: TRecord, wild_data: Record<string, unknown> = {}) {
		if (initial_data === undefined) return;
		for (const [k, v] of initial_data as unknown as Map<string, unknown>) {
			this.data_.set(k, v);
		}
		for (const [k, v] of wild_data as unknown as Map<string, unknown>) {
			this.data_.set(k, v);
		}
	}

	public Cast<T extends object>(): Blackboard<T> {
		return this as unknown as Blackboard<T>;
	}

	public Set<T extends keyof TRecord>(key: T, value: TRecord[T]): void {
		this.data_.set(key as never, value);
	}

	public SetWild<T>(key: string, value: T): T {
		this.data_.set(key, value);
		return value;
	}

	public UpdateWild<T>(key: string, callback: (v: T | undefined) => T): T {
		const current_value = this.data_.get(key) as T | undefined;
		const new_value = callback(current_value);
		this.data_.set(key, new_value);
		return new_value;
	}

	public Get<T extends keyof TRecord>(key: T): TRecord[T] {
		return this.data_.get(key as never) as TRecord[T];
	}

	public Update<T extends keyof TRecord>(
		key: T,
		callback: (v: TRecord[T]) => TRecord[T],
	): TRecord[T] {
		const current_value = this.data_.get(key as never);
		const new_value = callback(current_value as never);
		this.data_.set(key as never, new_value);
		return new_value;
	}

	public GetWild<T>(key: string): T | undefined {
		return this.data_.get(key) as T | undefined;
	}

	public GetWildOrDefault<T>(key: string, default_value: T): T {
		return (this.data_.get(key) as T | undefined) ?? default_value;
	}

	public HasWild(key: string): boolean {
		return this.data_.has(key);
	}

	public DeleteWild(key: string): boolean {
		return this.data_.delete(key);
	}

	public GetWildOfType<T>(key: string, v_type: T): T | undefined {
		const value = this.data_.get(key);
		if (value === undefined) return undefined;
		if (typeOf(value) !== typeOf(v_type)) {
			warn(`Type mismatch for key "${key}": expected ${typeOf(v_type)}, got ${typeOf(value)}`);
			return undefined;
		}
		return value as T;
	}

	public GetOrDefaultWildOfType<T>(key: string, v_type: T, default_value: T): T {
		const value = this.data_.get(key);
		if (value === undefined) return default_value;
		if (typeOf(value) !== typeOf(v_type)) {
			warn(`Type mismatch for key "${key}": expected ${typeOf(v_type)}, got ${typeOf(value)}`);
			return default_value;
		}
		return value as T;
	}
}
