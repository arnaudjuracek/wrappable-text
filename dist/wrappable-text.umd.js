!function(e,r){"object"==typeof exports&&"undefined"!=typeof module?module.exports=r(require("@craigmorton/linebreak")):"function"==typeof define&&define.amd?define(["@craigmorton/linebreak"],r):(e||self).WrappableText=r(e.LineBreaker)}(this,function(e){function r(e){return e&&"object"==typeof e&&"default"in e?e:{default:e}}var n=/*#__PURE__*/r(e),t="\n",i=" ",a="­",o="​";function u(e){return e.length}/*#__PURE__*/
return function(){function e(e,r){var n=void 0===r?{}:r,l=n.measure,p=n.br,f=void 0===p?t:p,c=n.nbsp,s=void 0===c?i:c,v=n.shy,g=void 0===v?a:v,d=n.zwsp,h=void 0===d?o:d;this.measure=void 0===l?u:l,this.value=e.replace(new RegExp(f,"g"),t).replace(new RegExp(s,"g"),i).replace(new RegExp(g,"g"),a).replace(new RegExp(h,"g"),o)}var r,l=e.prototype;return l.wrap=function(e){var r=this;void 0===e&&(e=Number.POSITIVE_INFINITY);for(var t=[],i=function(e){for(var r=new n.default(e),t={};;){var i=r.nextBreak();if(!i)break;t[i.position]=i}return t}(this.value),o=0,u=function(){for(var n=o,u=0;n<r.value.length;){if(i[n]&&i[n].required&&!i[n].consumed){i[n].consumed=!0,n--;break}if((u+=r.measure(r.value.charAt(n)))>=e){var l=Object.values(i).reverse().find(function(e){return!e.consumed&&n>e.position});if(l){l.consumed=!0,n=l.position;break}}n++}var p=r.value.substring(o,n).trim();r.value.charAt(n-1)===a&&(p+="-"),p=p.replace(a,""),t.push({value:p,width:r.measure(p)}),o=n};o<this.value.length;)u();return{lines:t,overflow:!!t.find(function(r){return r.width>e})}},l.nowrap=function(e){void 0===e&&(e=Number.POSITIVE_INFINITY);var r=this.value.replace(new RegExp(t,"g"),"").replace(new RegExp(i,"g"),"").replace(new RegExp(a,"g"),"").replace(new RegExp(o,"g"),""),n=this.measure(r);return{lines:[{value:r,width:n}],overflow:n>e}},(r=[{key:"isEmpty",get:function(){return!this.value.replace(/\s/g,"").replace(new RegExp(t,"g"),"").replace(new RegExp(i,"g"),"").replace(new RegExp(a,"g"),"").replace(new RegExp(o,"g"),"")}}])&&function(e,r){for(var n=0;n<r.length;n++){var t=r[n];t.enumerable=t.enumerable||!1,t.configurable=!0,"value"in t&&(t.writable=!0),Object.defineProperty(e,t.key,t)}}(e.prototype,r),e}()});
//# sourceMappingURL=wrappable-text.umd.js.map
