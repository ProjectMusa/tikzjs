{
  const ft = require('./factory').factory
  function err_not_impl(s) {
    return `${s} is not implemented`
  }
}
/////////////////////// Global //////////////////////////
start 
  = t:tikz { return new ft.tikzRoot(location(), [t]) } 
  / p:tikzpicture { return new ft.tikzRoot(location(), [p]) }

tikz  
  = tikzhead opt:tikzoption lbrace cnt:tikzcontent rbrace { return new ft.tikzInline(location(), opt, cnt); }

tikzpicture 
  = tikzpicturehead opt:tikzoption cnt:tikzcontent tikzpicturetail { return new ft.tikzPicture(location(), opt, cnt); }

tikzhead 
  = ws ('\\tikz'/'\\tikzjs') ws 

tikzpicturehead 
  = begin lbrace ('tikzpicture'/'tikzjspicture') rbrace 

tikzpicturetail
  = end lbrace ('tikzpicture'/'tikzjspicture') rbrace

tikzoption 
  = lbracket list:option_list rbracket { return list; }
  / ws { return []; }

option_list "option list" 
  = x:(option|.., comma|) comma? { return x; }

option "global option"
  = b:bool_option { return ft.tikzOption(location(), b); }// TODO add  override option
  // / ov: override_option


bool_option "global bool option" //TODO add more options
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
  // \ foreach_statement

path_statement
  = h:path_head opt:tikzoption opr:operation_list semicolon { return new ft.tikzPath(location(), h, opt, opr); }

path_head 
  = '\\path'
  // / '\\draw'
  // / '\\fill'
  // / '\\filldraw'
  // / '\\pattern'
  // / '\\shade'
  // / '\\shadedraw'
  // / '\\clip'
  // //shor hand for node shapes
  // / '\\node'
  // / '\\matrix'

operation_list
  = list:(path_operation|.., ws|) { return list; }

path_operation
  = c:path_coordinate { return c; }
  / l:line_operation { return l; }
  / g:grid_operation { return g; }
  / b:curve_operation { return b; }
  / t:topath_operation { return t; }
  // / node_operation
  // / rectangle_operation
  // / circle_operation
  // / ellipse_operation
  // / arc_operation
  // / foreach_operation
  // / let_operation

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

grid_operation
  = grid_operation_head opt:tikzoption {return new ft.tikzGridOperation(location(), opt); }

grid_operation_head
  = ws 'grid' ws

curve_operation
  = dotdot curve_control c:path_coordinate dotdot { return new ft.tikzCurveOperation(location(), c); }
  / dotdot curve_control c0:path_coordinate and c1:path_coordinate dotdot { return new ft.tikzCurveOperation(location(), c0, c1); }

curve_control = ws 'controls' ws

topath_operation
  = to opt:tikzoption { return new ft.tikzToPathOperation(location(), opt); }

/////////////////// Primitives ////////////////////////

lpar = ws "(" ws

rpar = ws ")" ws

rbrace = ws '}' ws

lbrace = ws '{' ws

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

plus = '+'

plusplus = '++'

ws "whitespace" = [ \t\n\r]*

in = ws 'in' ws 

at = ws 'at' ws

to = ws 'to' ws

and = ws 'and' ws

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



