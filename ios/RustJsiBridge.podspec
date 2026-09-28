require "json"

package = JSON.parse(File.read(File.join(__dir__, "../package.json")))

Pod::Spec.new do |s|
  s.name         = "RustJsiBridge"
  s.version      = package["version"]
  s.summary      = "Rust JSI bridge for silent-pay-wallet"
  s.homepage     = "https://github.com/Bitshala-Incubator/silent-pay-wallet"
  s.license      = package["license"] || "MIT"
  s.authors      = { "bitshala" => "dev@bitshala.org" }

  s.platforms    = { :ios => "16.4" }
  s.source       = { :git => ".git", :tag => "#{s.version}" }

  s.source_files = "RustJsiBridge/**/*.{h,m,mm,cpp}"
  # RustJsiBridge.h is C++ (jsi), so only the Objective-C module header is public.
  s.public_header_files = "RustJsiBridge/RustJsiBridgeModule.h"

  # Link Rust static libraries. Built by `npm run rust:build`, which writes
  # the xcframework here (alongside this podspec). See README iOS section.
  s.vendored_frameworks = "RustJsiBridge.xcframework"

  # React Native headers, TurboModule support and the app's codegen output (ShroudSpecs).
  install_modules_dependencies(s)
end
