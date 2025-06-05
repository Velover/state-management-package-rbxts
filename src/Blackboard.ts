export class Blackboard<TRecord extends object = object> {
	protected data_ = new Map<string, unknown>();

	constructor(initial_data: TRecord, wild_data: Record<string, unknown> = {}) {
		if (initial_data === undefined) return;
		for (const [k, v] of initial_data as Map<unknown, unknown>) {
			this.data_.set(k as never, v);
		}
		for (const [k, v] of pairs(wild_data)) {
			this.data_.set(k, v);
		}
	}

	public Cast<T extends object>(): Blackboard<T> {
		return this as unknown as Blackboard<T>;
	}

	public Set<T extends keyof TRecord>(key: T, value: TRecord[T]): void {
		this.data_.set(key as never, value);
	}

	public SetWild(key: string, value: unknown): void {
		this.data_.set(key, value);
	}

	public Get<T extends keyof TRecord>(key: T): TRecord[T] {
		return this.data_.get(key as never) as TRecord[T];
	}

	public GetWild<T>(key: string): T | undefined {
		return this.data_.get(key) as T | undefined;
	}

	public GetOrDefaultWild<T>(key: string, default_value: T): T {
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

	public Equals(target: Blackboard): boolean {
		const target_data = target.data_;
		if (target_data.size() !== this.data_.size()) return false;

		for (const [k, v] of target.data_) {
			if (this.data_.get(k) !== v) return false;
		}

		return true;
	}
}
