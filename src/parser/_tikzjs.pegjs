{
  const ft = require('./factory').factory
  const gc = require('./factory').g
  function err_not_impl(s) {
    return `${s} is not implemented`
  }
}
/////////////////////// Global //////////////////////////
start 
  = t:tikz { return new ft.tikzRoot(location(), [t]) } 
  / p:tikzpicture { return new ft.tikzRoot(location(), [p]) }

tikz  
  = tikzhead opt:tikzoption l:lbrace cnt:tikzcontent r:rbrace { return new ft.tikzInline(location(), opt, cnt); }

tikzpicture 
  = tikzpicturehead opt:tikzoption cnt:tikzcontent tikzpicturetail { return new ft.tikzPicture(location(), opt, cnt); }

tikzhead 
  = ws ('\\tikz'/'\\tikzjs') ws

tikzpicturehead 
  = begin l:lbrace ('tikzpicture'/'tikzjspicture') r:rbrace { gc.beginGroup('@env_tikzpicture'); }

tikzpicturetail
  = end lbrace ('tikzpicture'/'tikzjspicture') rbrace { gc.endGroup('@env_tikzpicture'); }

tikzoption 
  = lbracket list:option_list rbracket { return list; }
  / ws { return []; }

option_list "option list" 
  = x:(option|.., comma|) comma? { return x; }

option "tikz option"
  = b:bool_option { return ft.tikzOption(location(), b); }
  // / ov:override_option { return ft.tikzOption(location(), ov); }

bool_option "bool option" //TODO add more options
  = 'draw'

tikzcontent
  = ws list:statement_list ws { return list; }

begin_env
  = begin lbrace env_name rbrace

end_env
  = end lbrace env_name rbrace

env_name // envs other than tikzjspicture tikzpicture
  = "env_test"

begin
  = "\\begin"

end 
  = "\\end"


////////////////// COORDINATE SPEC ///////////////////////////

path_coordinate
  = c:coordinate { return new ft.tikzCoordinate(location(), c.offset_list,'' ,c.cs_type); }
  / plus c:coordinate { return new ft.tikzCoordinate(location(), c.offset_list,'+' ,c.cs_type); }
  / plusplus c:coordinate { return new ft.tikzCoordinate(location(), c.offset_list,'++' ,c.cs_type); }
  / a:node_alias { return new ft.tikzNodeAliasCoordinate(location(), a, undefined); }
  / ac: node_alias_anchor { return new ft.tikzNodeAliasCoordinate(location(), ac[0], ac[1]); }


coordinate
  = coordinate_canvas 
  / coordinate_canvas_polar
  // TODO add coordinate_xyz etc

coordinate_canvas
  = lpar x:offset_expr comma y:offset_expr rpar  { return {'offset_list': [x, y], "cs_type": 'canvas'}; }
  / lpar 'canvas cs' colon 'x' eq x_:offset_expr comma 'y' eq y_:offset_expr rpar { return {'offset_list': [x_, y_], "cs_type": 'canvas'}; }

coordinate_canvas_polar
  = lpar angle:offset_expr colon radius:offset_expr rpar { return {'offset_list': [angle, radius], "cs_type": 'ploar'}; }
  / lpar 'canvas polar cs' colon 'angle' eq angle_:offset_expr comma 'radius' eq radius_:offset_expr rpar { return {'offset_list': [angle_, radius_], "cs_type": 'ploar'}; }

offset_expr
  = n:number ws u:unit ws { return new ft.tikzCoordinateOffset(location(), n, u); }
  / n:number { return new ft.tikzCoordinateOffset(location(), n); }


unit 
  = "cm"
  / "mm" 
  / "pt" 
  / "ex"
  / "rm"
  / "deg"

//////////////////// PATH SPEC ////////////////////////
statement_list
  = list:(statement|.., ws|) { return list; }

statement
  = path_statement
  // / foreach_statement

path_statement
  = h:path_head opt:tikzoption opr:operation_list semicolon { return new ft.tikzPath(location(), h, opt, opr); }
  / node_path_statement


path_head 
  = '\\path'
  // / '\\draw'
  // / '\\fill'
  // / '\\filldraw'
  // / '\\pattern'
  // / '\\shade'
  // / '\\shadedraw'
  // / '\\clip'
  // //short hand for node shapes
  // / '\\node'
  // / '\\matrix'

node_path_statement
  = escape n:node_operation opr:operation_list semicolon { return new ft.tikzPath(location(), '\\node', [], [n, ...opr]) }

operation_list
  = list:(path_operation|.., ws|) { return list; }

path_operation
  = c:path_coordinate { return c; }
  / l:line_operation { return l; }
  / g:grid_operation { return g; }
  / b:curve_operation { return b; }
  / t:topath_operation { return t; }
  / n:node_operation { return n; }
  // / e:edge_operation { return e; }
  // / rectangle_operation
  // / circle_operation
  // / ellipse_operation
  // / arc_operation
  // / foreach_operation
  // / let_operation


////////// line operations /////////////
line_operation
  = streight_line_operation { return new ft.tikzLineOperation(location(), '--'); }
  / hv_corner_operation { return new ft.tikzLineOperation(location(), '-|'); }
  / vh_corner_operation { return new ft.tikzLineOperation(location(), '|-'); }

streight_line_operation
  = ws '--' ws

hv_corner_operation
  = ws '-|' ws

vh_corner_operation 
  = ws '|-' ws

////////// grid operations /////////////
grid_operation
  = grid_operation_head opt:tikzoption {return new ft.tikzGridOperation(location(), opt); }

grid_operation_head
  = ws 'grid' ws


//////// curve operations /////////////
curve_operation
  = dotdot curve_control c:path_coordinate dotdot { return new ft.tikzCurveOperation(location(), c); }
  / dotdot curve_control c0:path_coordinate and c1:path_coordinate dotdot { return new ft.tikzCurveOperation(location(), c0, c1); }

curve_control = ws 'controls' ws

////////// to-path operations /////////////
topath_operation
  = to opt:tikzoption { return new ft.tikzToPathOperation(location(), opt); }

// ///////// node operations //////////////
node_operation
  = node_head opt:tikzoption al:node_alias at:node_at cnt:node_content {return new ft.tikzNodeOperation(location(), opt, al, at, cnt)}
  / node_head opt:tikzoption at:node_at cnt:node_content {return new ft.tikzNodeOperation(location(), opt, undefined, at, cnt)}

node_head = ws 'node' ws

node_alias 
  = lpar name:identifier rpar { return name; }

node_alias_anchor 
  = lpar name:identifier tight_dot anchor: identifier rpar { return [name, anchor]; }

node_at
  = at c:path_coordinate { return c; }
  / ws { return undefined; }

//
node_content
  = lbrace li:latex_inline rbrace { return li; }
  / ws { return undefined; }

latex_inline
  = x:(latex_plain / latex_math)+ { return x.join(''); }

latex_plain
  = p:(latex_plain_primitive)+ { return `\\text{${text()}}`; }

// this rule must always return a string
latex_plain_primitive "primitive" =
      char
    / utf8_char
    / hyphen
    / decimal_digit   {return text();}
    / punctuation
    / quotes
    / escape identifier { return text();}
    / lbrace  rbrace
    / lbrace (latex_plain_primitive)+ rbrace { return text(); }
    / line_break
    / sp
    / ctrl_space
    / ctrl_sym
    

latex_math 
  = math_shift m:(latex_math_primitive)+ math_shift { return text().slice(1,-1); }
  / inline_math_begin m:(latex_math_primitive)+ inline_math_end { return text().slice(2,-2); }

latex_math_primitive =
    latex_plain_primitive
    / alignment_tab
    / superscript
    / subscript
    / escape identifier { return text();}
    / lbrace  rbrace
    / lbrace (latex_math_primitive)+ rbrace { return text(); }

identifier =
    $char+


/////////////////// Primitives ////////////////////////
punctuation "punctuation"   = p:[.,;:\*/()!?=+<>]                
macro_parameter "parameter" = "#"                                
quotes      "quotes"        = q:[`']                            
utf8_char   "utf8 char"     = !(sp/ ctrl_sym/ char/ hyphen / escape / lbrace / rbrace / math_shift / alignment_tab /
                                superscript / subscript )
                               u:.                              
hyphen      "hyphen"        = "-"                               
ctrl_sym    "control symbol"= escape c:[$%#&{}_\-,/@]    
char        "letter"        = c:[a-zA-Z]i                          
line_break   "line_break"   = ws '\\\\' ws
escape       "escape"       = '\\' { return '\\'; }
ctrl_space "latex space"    = ws'\\ 'ws




/* text tokens - symbols that generate output */
alignment_tab "alignment"   = ws '&'ws
superscript "supperscript"  = ws '^' ws
subscript   "subscript"     = ws '_' ws
math_shift  "latex inline"  = ws '$' ws &{ return gc.checkValid('$'); } { gc.toggleMathScope('$'); return text(); }
inline_math_begin = ws '\\(' ws &{ return gc.checkValid('\\('); } { gc.toggleMathScope('\\('); return text(); }
inline_math_end = ws '\\)' ws &{ return gc.checkValid('\\)'); } { gc.toggleMathScope('\\)'); return text(); }
lpar = ws "(" ws 
rpar = ws ")" ws 
rbrace = ws '}' ws &{ return gc.checkValid('rbrace'); } {gc.endGroup('rbrace'); return text();}
lbrace = ws '{' ws &{ return gc.checkValid('lbrace'); } {gc.beginGroup('lbrace'); return text(); }
lbracket = ws '[' ws 
rbracket =ws ']' ws
comma = ws ',' ws
colon = ws ':' ws
semicolon = ws ';' ws
eq = ws '=' ws
double_dots = ws '..' ws 
dot = ws '.' ws
tight_dot = '.'
dotdot = ws '..' ws
plus = ws '+' ws
plusplus = ws '++' ws
in = ws 'in' ws 
at = ws 'at' ws
to = ws 'to' ws
and = ws 'and' ws
ws "whitespace" = [ \t\n\r]*
sp = [ \t]+ {return ' ';}

number
  = signed_integer_literal tight_dot decimal_digit* {
      return parseFloat(text());
    }
  / tight_dot decimal_digit+ {
      return parseFloat(text());
    }
  / signed_integer_literal {
      return  parseFloat(text());
    }

signed_integer_literal
  = [+-]? decimal_integer_literal

decimal_integer_literal
  = "0"
  / nonzero_digit decimal_digit*

decimal_digit
  = [0-9]

nonzero_digit
  = [1-9]



