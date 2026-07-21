// Bundle 入口。IIFE 包裹后，下面的 Object.assign 在加载时把三个生命周期函数挂到全局供 Bob 调用
// ——即经典「脚本全局」契约，无需 CommonJS，故 minBobVersion 可保持 1.6.0。
import { supportLanguages } from './languages';
import { translate } from './translate';

function pluginTimeoutInterval(): number {
  return 60;
}

Object.assign(globalThis, { translate, supportLanguages, pluginTimeoutInterval });
