interface Position {
    offset?: number;
    row?: number;
    column?: number;
}
interface TextLocation {
    start?: Position;
    end?: Position;
}
export declare class ASTNode {
    type: string;
    location: TextLocation;
    constructor(_type: string, _location: TextLocation);
}
export {};
