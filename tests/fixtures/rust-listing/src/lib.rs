//! Minimal fixture: one bare `#[test]` fn and one `#[cfg(test)]` inline module.

pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[test]
fn adds_bare() {
    assert_eq!(add(1, 2), 3);
}

#[cfg(test)]
mod tests {
    use super::add;

    #[test]
    fn adds_inline() {
        assert_eq!(add(2, 3), 5);
    }
}
