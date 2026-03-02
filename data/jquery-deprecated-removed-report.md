# Reporte jQuery Deprecated/Removed

Generado: 2026-03-02T08:15:08.879Z

Fuentes de categoria rastreadas:
- https://api.jquery.com/category/deprecated/
- https://api.jquery.com/category/deprecated/deprecated-1.3/
- https://api.jquery.com/category/deprecated/deprecated-1.7/
- https://api.jquery.com/category/deprecated/deprecated-1.8/
- https://api.jquery.com/category/deprecated/deprecated-1.9/
- https://api.jquery.com/category/deprecated/deprecated-1.10-and-2.0/
- https://api.jquery.com/category/deprecated/deprecated-3.0/
- https://api.jquery.com/category/deprecated/deprecated-3.2/
- https://api.jquery.com/category/deprecated/deprecated-3.3/
- https://api.jquery.com/category/deprecated/deprecated-3.4/
- https://api.jquery.com/category/deprecated/deprecated-3.5/
- https://api.jquery.com/category/deprecated/deprecated-3.7/
- https://api.jquery.com/category/removed/

| API | Estado | Deprecated In | Removed In | Solucion recomendada | URL |
|---|---|---|---|---|---|
| .ajaxComplete() | deprecated | 3.5 |  | .on( "ajaxComplete", handler ) | https://api.jquery.com/ajaxComplete-shorthand/ |
| .ajaxError() | deprecated | 3.5 |  | .on( "ajaxError", handler ) | https://api.jquery.com/ajaxError-shorthand/ |
| .ajaxSend() | deprecated | 3.5 |  | .on( "ajaxSend", handler ) | https://api.jquery.com/ajaxSend-shorthand/ |
| .ajaxStart() | deprecated | 3.5 |  | .on( "ajaxStart", handler ) | https://api.jquery.com/ajaxStart-shorthand/ |
| .ajaxStop() | deprecated | 3.5 |  | .on( "ajaxStop", handler ) | https://api.jquery.com/ajaxStop-shorthand/ |
| .ajaxSuccess() | deprecated | 3.5 |  | .on( "ajaxSuccess", handler ) | https://api.jquery.com/ajaxSuccess-shorthand/ |
| .andSelf() | deprecated, removed | 1.8 | 3.0 | Reemplaza `.andSelf()` por `.addBack()`. | https://api.jquery.com/andSelf/ |
| .attr("checked", value) para estado dinámico | deprecated | 1.6+ (usar .prop para booleanos) |  | Reemplaza `.attr('checked', valor)` por `.prop('checked', valor)` para reflejar el estado actual. | https://api.jquery.com/prop/ |
| .bind() | deprecated | 3.0 |  | Reemplaza `.bind()` por `.on()`. | https://api.jquery.com/bind/ |
| .blur() | deprecated | 3.3 |  | .on( "blur", handler ) or .on( "blur", eventData, handler ), respectively | https://api.jquery.com/blur-shorthand/ |
| .change() | deprecated | 3.3 |  | .on( "change", handler ) or .on( "change", eventData, handler ), respectively | https://api.jquery.com/change-shorthand/ |
| .click() | deprecated | 3.3 |  | .on( "click", handler ) or .on( "click", eventData, handler ), respectively | https://api.jquery.com/click-shorthand/ |
| .context | deprecated, removed | 1.10-and-2.0 | 3.0 | `.context` fue removido. Pasa el contexto explícitamente en `$(selector, contexto)` o usa variables de DOM. | https://api.jquery.com/context/ |
| .contextmenu() | deprecated | 3.3 |  | .on( "contextmenu", handler ) or .on( "contextmenu", eventData, handler ), respectively | https://api.jquery.com/contextmenu-shorthand/ |
| .dblclick() | deprecated | 3.3 |  | .on( "dblclick", handler ) or .on( "dblclick", eventData, handler ), respectively | https://api.jquery.com/dblclick-shorthand/ |
| deferred.isRejected() | deprecated, removed | 1.7 | 1.8 | Reemplaza `deferred.isRejected()` por `deferred.state() === "rejected"`. | https://api.jquery.com/deferred.isRejected/ |
| deferred.isResolved() | deprecated, removed | 1.7 | 1.8 | Reemplaza `deferred.isResolved()` por `deferred.state() === "resolved"`. | https://api.jquery.com/deferred.isResolved/ |
| deferred.pipe() | deprecated | 1.8 |  | Reemplaza `deferred.pipe(...)` por `deferred.then(doneFilter, failFilter, progressFilter)`. | https://api.jquery.com/deferred.pipe/ |
| .delegate() | deprecated | 3.0 |  | Reemplaza `.delegate(selector, events, handler)` por `.on(events, selector, handler)`. | https://api.jquery.com/delegate/ |
| .die() | deprecated, removed | 1.7 | 1.9 | Reemplaza `.die()` por `.off(evento, selector, handler)` en el elemento delegado. | https://api.jquery.com/die/ |
| :eq() Selector | deprecated | 3.4 |  | Quita `:eq()` del selector y filtra después con `.eq(indice)`. | https://api.jquery.com/eq-selector/ |
| .error() | deprecated, removed | 1.8 | 3.0 | .on( "error", handler ) or .on( "error", eventData, handler ), respectively | https://api.jquery.com/error-shorthand/ |
| :even Selector | deprecated | 3.4 |  | Quita `:even` del selector y filtra después con `.even()`. | https://api.jquery.com/even-selector/ |
| :first Selector | deprecated | 3.4 |  | Quita `:first` del selector y filtra después con `.first()`. | https://api.jquery.com/first-selector/ |
| .focus() | deprecated | 3.3 |  | .on( "focus", handler ) or .on( "focus", eventData, handler ), respectively | https://api.jquery.com/focus-shorthand/ |
| .focusin() | deprecated | 3.3 |  | .on( "focusin", handler ) or .on( "focusin", eventData, handler ), respectively | https://api.jquery.com/focusin-shorthand/ |
| .focusout() | deprecated | 3.3 |  | .on( "focusout", handler ) or .on( "focusout", eventData, handler ), respectively | https://api.jquery.com/focusout-shorthand/ |
| :gt() Selector | deprecated | 3.4 |  | Quita `:gt(n)` del selector y filtra después con `.slice(n + 1)`. | https://api.jquery.com/gt-selector/ |
| .hover() | deprecated | 3.3 |  | Reemplaza `.hover(in, out)` por `.on("mouseenter", in).on("mouseleave", out)`. | https://api.jquery.com/hover/ |
| jQuery.boxModel | deprecated, removed | 1.3 | 1.8 | Reemplaza `jQuery.boxModel` por `document.compatMode === "CSS1Compat"`. | https://api.jquery.com/jQuery.boxModel/ |
| jQuery.browser | deprecated, removed | 1.3 | 1.9 | Reemplaza `jQuery.browser` por feature detection y APIs estándar del navegador. | https://api.jquery.com/jQuery.browser/ |
| jQuery.Deferred.getStackHook() | deprecated, removed | 3.7 | 4.0 | Reemplaza `jQuery.Deferred.getStackHook()` por `jQuery.Deferred.getErrorHook()`. | https://api.jquery.com/jQuery.Deferred.getStackHook/ |
| jQuery.fx.interval | deprecated, removed | 3.0 | 4.0 | `jQuery.fx.interval` está deprecado; en navegadores modernos no tiene efecto con `requestAnimationFrame`. | https://api.jquery.com/jQuery.fx.interval/ |
| jQuery.holdReady() | deprecated | 3.2 |  | Evita `jQuery.holdReady()`: usa `$.when($.ready, promesaPersonalizada).then(...)` para sincronizar ready + async. | https://api.jquery.com/jQuery.holdReady/ |
| jQuery.isArray() | deprecated, removed | 3.2 | 4.0 | Reemplaza `jQuery.isArray(value)` por `Array.isArray(value)`. | https://api.jquery.com/jQuery.isArray/ |
| jQuery.isFunction() | deprecated, removed | 3.3 | 4.0 | Reemplaza `jQuery.isFunction(value)` por `typeof value === "function"`. | https://api.jquery.com/jQuery.isFunction/ |
| jQuery.isNumeric() | deprecated, removed | 3.3 | 4.0 | Reemplaza `jQuery.isNumeric(value)` por `Number.isFinite(Number(value))` según tu caso. | https://api.jquery.com/jQuery.isNumeric/ |
| jQuery.isWindow() | deprecated, removed | 3.3 | 4.0 | Reemplaza `jQuery.isWindow(obj)` por `obj != null && obj === obj.window`. | https://api.jquery.com/jQuery.isWindow/ |
| jQuery.now() | deprecated, removed | 3.3 | 4.0 | Reemplaza `jQuery.now()` por `Date.now()`. | https://api.jquery.com/jQuery.now/ |
| jQuery.parseJSON() | deprecated, removed | 3.0 | 4.0 | Reemplaza `jQuery.parseJSON(texto)` por `JSON.parse(texto)` con `try/catch`. | https://api.jquery.com/jQuery.parseJSON/ |
| jQuery.proxy() | deprecated | 3.3 |  | Reemplaza `jQuery.proxy(fn, contexto)` por `fn.bind(contexto)` o funciones flecha. | https://api.jquery.com/jQuery.proxy/ |
| jQuery.sub() | deprecated, removed | 1.7 | 1.9 | `jQuery.sub()` fue removido; usa módulos/plugins aislados en vez de clonar el objeto jQuery global. | https://api.jquery.com/jQuery.sub/ |
| jQuery.support | deprecated | 1.9 |  | Reemplaza `jQuery.support` por comprobaciones directas de capacidades del navegador. | https://api.jquery.com/jQuery.support/ |
| jQuery.trim() | deprecated, removed | 3.5 | 4.0 | Reemplaza `jQuery.trim(valor)` por `String(valor).trim()` (controla `null/undefined` según tu caso). | https://api.jquery.com/jQuery.trim/ |
| jQuery.type() | deprecated, removed | 3.3 | 4.0 | Reemplaza `jQuery.type(obj)` por combinaciones de `typeof`, `Array.isArray` y `Object.prototype.toString.call(obj)`. | https://api.jquery.com/jQuery.type/ |
| jQuery.unique() | deprecated, removed | 3.0 |  | Reemplaza `jQuery.unique(array)` por `jQuery.uniqueSort(array)`. | https://api.jquery.com/jQuery.unique/ |
| .keydown() | deprecated | 3.3 |  | .on( "keydown", handler ) or .on( "keydown", eventData, handler ), respectively | https://api.jquery.com/keydown-shorthand/ |
| .keypress() | deprecated | 3.3 |  | .on( "keypress", handler ) or .on( "keypress", eventData, handler ), respectively | https://api.jquery.com/keypress-shorthand/ |
| .keyup() | deprecated | 3.3 |  | .on( "keyup", handler ) or .on( "keyup", eventData, handler ), respectively | https://api.jquery.com/keyup-shorthand/ |
| :last Selector | deprecated | 3.4 |  | Quita `:last` del selector y filtra después con `.last()`. | https://api.jquery.com/last-selector/ |
| .live() | deprecated, removed | 1.7 | 1.9 | Reemplaza `.live()` por delegación con `.on(evento, selector, handler)`. | https://api.jquery.com/live/ |
| .load() | deprecated, removed | 1.8 | 3.0 | .on( "load", handler ) or .on( "load", eventData, handler ), respectively | https://api.jquery.com/load-shorthand/ |
| :lt() Selector | deprecated | 3.4 |  | Quita `:lt(n)` del selector y filtra después con `.slice(0, n)`. | https://api.jquery.com/lt-selector/ |
| .mousedown() | deprecated | 3.3 |  | .on( "mousedown", handler ) or .on( "mousedown", eventData, handler ), respectively | https://api.jquery.com/mousedown-shorthand/ |
| .mouseenter() | deprecated | 3.3 |  | .on( "mouseenter", handler ) or .on( "mouseenter", eventData, handler ), respectively | https://api.jquery.com/mouseenter-shorthand/ |
| .mouseleave() | deprecated | 3.3 |  | .on( "mouseleave", handler ) or .on( "mouseleave", eventData, handler ), respectively | https://api.jquery.com/mouseleave-shorthand/ |
| .mousemove() | deprecated | 3.3 |  | .on( "mousemove", handler ) or .on( "mousemove", eventData, handler ), respectively | https://api.jquery.com/mousemove-shorthand/ |
| .mouseout() | deprecated | 3.3 |  | .on( "mouseout", handler ) or .on( "mouseout", eventData, handler ), respectively | https://api.jquery.com/mouseout-shorthand/ |
| .mouseover() | deprecated | 3.3 |  | .on( "mouseover", handler ) or .on( "mouseover", eventData, handler ), respectively | https://api.jquery.com/mouseover-shorthand/ |
| .mouseup() | deprecated | 3.3 |  | .on( "mouseup", handler ) or .on( "mouseup", eventData, handler ), respectively | https://api.jquery.com/mouseup-shorthand/ |
| :odd Selector | deprecated | 3.4 |  | Quita `:odd` del selector y filtra después con `.odd()`. | https://api.jquery.com/odd-selector/ |
| .ready() (syntaxis legacy deprecada) | deprecated | 3.0 |  | Reemplaza `$(document).ready(handler)` y variantes (`$jq(...).ready(handler)`, `$().ready(handler)`) por `$(handler)`. | https://api.jquery.com/ready/ |
| .resize() | deprecated | 3.3 |  | .on( "resize", handler ) or .on( "resize", eventData, handler ), respectively | https://api.jquery.com/resize-shorthand/ |
| .scroll() | deprecated | 3.3 |  | .on( "scroll", handler ) or .on( "scroll", eventData, handler ), respectively | https://api.jquery.com/scroll-shorthand/ |
| .select() | deprecated | 3.3 |  | .on( "select", handler ) or .on( "select", eventData, handler ), respectively | https://api.jquery.com/select-shorthand/ |
| .selector | deprecated, removed | 1.7 | 3.0 | `.selector` fue removido. Guarda el selector manualmente en tu propio estado si lo necesitas. | https://api.jquery.com/selector/ |
| .size() | deprecated, removed | 1.8 | 3.0 | Reemplaza `.size()` por la propiedad `.length`. | https://api.jquery.com/size/ |
| .submit() | deprecated | 3.3 |  | .on( "submit", handler ) or .on( "submit", eventData, handler ), respectively | https://api.jquery.com/submit-shorthand/ |
| .toggle() | deprecated, removed | 1.8 | 1.9 | La firma de `.toggle(fn1, fn2, ...)` fue removida. Usa `.on("click", handler)` y maneja estado explícitamente. | https://api.jquery.com/toggle-event/ |
| .unbind() | deprecated | 3.0 |  | Reemplaza `.unbind()` por `.off()`. | https://api.jquery.com/unbind/ |
| .undelegate() | deprecated | 3.0 |  | Reemplaza `.undelegate(...)` por `.off(...)` conservando el selector delegado. | https://api.jquery.com/undelegate/ |
| .unload() | deprecated, removed | 1.8 | 3.0 | .on( "unload", handler ) or .on( "unload", eventData, handler ), respectively | https://api.jquery.com/unload-shorthand/ |
