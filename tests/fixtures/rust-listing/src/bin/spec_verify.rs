//! Bin target whose src-colocated `#[cfg(test)]` tests list with the full
//! module path — the shape real cargo repos produce (agent-spec lists
//! `spec_verify::boundaries::tests::test_x`) and bare-name selectors must
//! resolve against.

#[cfg(test)]
mod spec_verify {
    #[cfg(test)]
    mod boundaries {
        #[cfg(test)]
        mod tests {
            #[test]
            fn test_my_pin() {
                assert_eq!(2 + 2, 4);
            }
        }
    }
}
