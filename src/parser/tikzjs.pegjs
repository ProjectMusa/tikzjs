{
  const ast = require('./ast.ts')
  function err_not_impl(s) {
    return `${s} is not implemented`
  }
}

start 
  = t:tikz {return new ast.ASTNode({type:'root', location: location()}) } / p:tikzpicture {return new ast.ASTNode({type:'root', location: location()})}

tikz = h:tikzhead opt:tikzoption lbrace c:tikzcontent rbrace {return {
  tikzoption: opt,
  tikzcontent: c
}}

tikzpicture = h:tikzpicturehead opt:tikzoption c:tikzcontent t:tikzpicturetail {return {tikzoption: opt, tikzcontent:c}}

tikzhead 
  = ws ('\\tikz'/'\\tikzjs') ws 

tikzpicturehead 
  = begin lbrace ('\\tikzpicture'/'\\tikzjspicture') rbrace 

tikzpicturetail
  = end lbrace ('\\tikzpicture'/'\\tikzjspicture') rbrace

tikzoption 
  = lbracket x:option_list_gl rbracket {return x;}

tikzcontent
  = ws {return {}} // TODO add path_declare

option_list_gl "global option list" 
  = option_gl|.., comma|

option_gl "global option"
  = gbo:bool_option_gl {return gbo}// TODO add global override option

bool_option_gl "global bool option" //TODO add more global options
 = "option"

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

coordinate
  = coordinate_canvas / coordinate_canvas_polar // TODO add coordinate_xyz etc

coordinate_canvas
  = lpar x:shift_expr comma y:shift_expr rpar  
  / lpar 'canvas cs' colon 'x' eq x_:shift_expr comma 'y' eq y_:shift_expr rpar

coordinate_canvas_polar
  = lpar angle:number colon radius:shift_expr rpar
  / lpar 'canvas polar cs' colon 'angle' eq angle_:number comma 'radius'  eq radius_:shift_expr rpar

shift_expr
  = number/ number unit


unit = "cm"/ "mm" / "pt" / "ex"

//////////////////// PATH SPEC ////////////////////////

predefined_shape = "square" / "circle" // TODO add more shapes


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

ws "whitespace" = [ \t\n\r]*

number
  = decimal_integer_literal tight_dot decimal_digit* {
      return { type: 'Literal', value: parseFloat(text()) };
    }
  / tight_dot decimal_digit+ {
      return { type: 'Literal', value: parseFloat(text()) };
    }
  / decimal_integer_literal {
      return { type: 'Literal', value: parseFloat(text()) };
    }

decimal_integer_literal
  = "0"
  / nonzero_digit decimal_digit*

decimal_digit
  = [0-9]

nonzero_digit
  = [1-9]

