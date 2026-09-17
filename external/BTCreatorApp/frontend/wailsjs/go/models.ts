export namespace main {
	
	export class BakeSwitchCase {
	    cases: Record<string, string>;
	    default?: string;
	    parameter_name: string;
	
	    static createFrom(source: any = {}) {
	        return new BakeSwitchCase(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cases = source["cases"];
	        this.default = source["default"];
	        this.parameter_name = source["parameter_name"];
	    }
	}
	export class BakeNodeStructure {
	    name: string;
	    children: string[];
	    parameters?: Record<string, any>;
	    switch_case?: BakeSwitchCase;
	
	    static createFrom(source: any = {}) {
	        return new BakeNodeStructure(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.children = source["children"];
	        this.parameters = source["parameters"];
	        this.switch_case = this.convertValues(source["switch_case"], BakeSwitchCase);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class BehaviorTreeBakeData {
	    name: string;
	    structure: Record<string, BakeNodeStructure>;
	    baked_at: string;
	    version: string;
	
	    static createFrom(source: any = {}) {
	        return new BehaviorTreeBakeData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.structure = this.convertValues(source["structure"], BakeNodeStructure, true);
	        this.baked_at = source["baked_at"];
	        this.version = source["version"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BehaviorTreeSaveData {
	    nodes: number[];
	    edges: number[];
	    customNodes: number[];
	    nextNodeId: number;
	    version: string;
	    lastSaved: string;
	
	    static createFrom(source: any = {}) {
	        return new BehaviorTreeSaveData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodes = source["nodes"];
	        this.edges = source["edges"];
	        this.customNodes = source["customNodes"];
	        this.nextNodeId = source["nextNodeId"];
	        this.version = source["version"];
	        this.lastSaved = source["lastSaved"];
	    }
	}

}

