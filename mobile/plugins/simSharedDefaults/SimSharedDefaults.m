// Objective-C bridge that exposes the Swift SimSharedDefaults class to the
// React Native bridge. RCT_EXTERN_MODULE registers the class by name (the
// @objc(SimSharedDefaults) in the .swift), so no -Swift.h import is needed.
//
// Selectors match the JS calls in deviceToken.ts:
//   NativeModules.SimSharedDefaults.setItem(suite, key, value)
//   NativeModules.SimSharedDefaults.removeItem(suite, key)
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SimSharedDefaults, NSObject)

RCT_EXTERN_METHOD(setItem:(NSString *)suite key:(NSString *)key value:(NSString *)value)
RCT_EXTERN_METHOD(removeItem:(NSString *)suite key:(NSString *)key)

@end
